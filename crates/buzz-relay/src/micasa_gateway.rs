//! Trusted MiCasa gateway authorization for public NIP-42 relay aliases.
//!
//! Buzz still resolves the household community from the internal connection
//! host. A Personal-Agent gateway may ask that one connection to verify NIP-42
//! against MiCasa's public same-origin WebSocket URL only when all four internal
//! headers carry a fresh HMAC bound to both hosts. Ordinary direct relay
//! connections retain the existing per-community host binding.

use std::fmt;

use axum::http::HeaderMap;
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

const HEADER_AUTHORITY: &str = "x-micasa-gateway-authority";
const HEADER_EXPIRES: &str = "x-micasa-gateway-expires";
const HEADER_NONCE: &str = "x-micasa-gateway-nonce";
const HEADER_PUBLIC_RELAY: &str = "x-micasa-gateway-public-relay";
const PURPOSE: &str = "micasa-relay-gateway-v1";
const MAX_ENVELOPE_TTL_SECONDS: u64 = 30;
const MICASA_REALTIME_PATH: &str = "/api/micasa/v1/realtime";

type HmacSha256 = Hmac<Sha256>;

/// Validated operator configuration for the trusted MiCasa gateway.
#[derive(Clone)]
pub struct MiCasaGatewayConfig {
    public_relay_url: String,
    shared_secret: [u8; 32],
}

impl MiCasaGatewayConfig {
    /// Build the optional configuration from paired environment values.
    ///
    /// Both values must be absent to disable the gateway. The secret is exactly
    /// 32 random bytes encoded as 64 lowercase hexadecimal characters.
    pub fn from_values(
        public_relay_url: Option<String>,
        shared_secret_hex: Option<String>,
    ) -> Result<Option<Self>, String> {
        match (public_relay_url, shared_secret_hex) {
            (None, None) => Ok(None),
            (Some(url), Some(secret_hex)) => {
                let public_relay_url = validate_public_relay_url(&url)?;
                if secret_hex.len() != 64
                    || !secret_hex
                        .bytes()
                        .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
                {
                    return Err(
                        "BUZZ_MICASA_GATEWAY_SECRET_HEX must be 64 lowercase hex characters"
                            .to_string(),
                    );
                }
                let decoded = hex::decode(secret_hex).map_err(|_| {
                    "BUZZ_MICASA_GATEWAY_SECRET_HEX must be 64 lowercase hex characters"
                        .to_string()
                })?;
                let shared_secret: [u8; 32] = decoded.try_into().map_err(|_| {
                    "BUZZ_MICASA_GATEWAY_SECRET_HEX must encode exactly 32 bytes".to_string()
                })?;
                Ok(Some(Self {
                    public_relay_url,
                    shared_secret,
                }))
            }
            _ => Err(
                "BUZZ_MICASA_PUBLIC_RELAY_URL and BUZZ_MICASA_GATEWAY_SECRET_HEX must be set together"
                    .to_string(),
            ),
        }
    }

    /// Public relay alias pinned by operator configuration.
    pub fn public_relay_url(&self) -> &str {
        &self.public_relay_url
    }
}

impl fmt::Debug for MiCasaGatewayConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MiCasaGatewayConfig")
            .field("public_relay_url", &self.public_relay_url)
            .field("shared_secret", &"[REDACTED]")
            .finish()
    }
}

/// Fail-closed internal gateway-header validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MiCasaGatewayError {
    /// A partial, duplicated, malformed, stale, or forged envelope was received.
    InvalidEnvelope,
    /// Gateway headers were sent while the operator configuration is disabled.
    NotConfigured,
}

fn validate_public_relay_url(value: &str) -> Result<String, String> {
    let parsed = url::Url::parse(value)
        .map_err(|_| "BUZZ_MICASA_PUBLIC_RELAY_URL must be an exact wss URL".to_string())?;
    if parsed.scheme() != "wss"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != MICASA_REALTIME_PATH
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.as_str() != value
    {
        return Err(
            "BUZZ_MICASA_PUBLIC_RELAY_URL must be an exact wss URL ending in /api/micasa/v1/realtime"
                .to_string(),
        );
    }
    Ok(value.to_string())
}

fn single_header<'a>(
    headers: &'a HeaderMap,
    name: &'static str,
) -> Result<Option<&'a str>, MiCasaGatewayError> {
    let mut values = headers.get_all(name).iter();
    let first = match values.next() {
        Some(value) => value,
        None => return Ok(None),
    };
    if values.next().is_some() {
        return Err(MiCasaGatewayError::InvalidEnvelope);
    }
    first
        .to_str()
        .map(Some)
        .map_err(|_| MiCasaGatewayError::InvalidEnvelope)
}

fn clean_authority(value: &str) -> Result<&str, MiCasaGatewayError> {
    if value.is_empty()
        || value.len() > 255
        || value.bytes().any(|byte| {
            !(byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || matches!(byte, b'.' | b'-' | b':' | b'[' | b']'))
        })
    {
        return Err(MiCasaGatewayError::InvalidEnvelope);
    }
    Ok(value)
}

fn lowercase_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Return the configured public NIP-42 relay alias for an authenticated
/// Personal-Agent gateway connection, or `None` for an ordinary direct
/// connection.
///
/// The household authority comes from Buzz's row-zero tenant resolution, never
/// from a header. The alias comes from operator configuration and must also
/// match the HMAC-covered header exactly.
pub fn authorize_gateway_headers(
    config: Option<&MiCasaGatewayConfig>,
    headers: &HeaderMap,
    household_authority: &str,
    now: u64,
) -> Result<Option<String>, MiCasaGatewayError> {
    let authority_signature = single_header(headers, HEADER_AUTHORITY)?;
    let expires = single_header(headers, HEADER_EXPIRES)?;
    let nonce = single_header(headers, HEADER_NONCE)?;
    let public_relay = single_header(headers, HEADER_PUBLIC_RELAY)?;

    if [authority_signature, expires, nonce, public_relay]
        .iter()
        .all(|value| value.is_none())
    {
        return Ok(None);
    }
    if [authority_signature, expires, nonce, public_relay]
        .iter()
        .any(|value| value.is_none())
    {
        return Err(MiCasaGatewayError::InvalidEnvelope);
    }

    let config = config.ok_or(MiCasaGatewayError::NotConfigured)?;
    let signature = authority_signature.expect("presence checked");
    let expires = expires
        .expect("presence checked")
        .parse::<u64>()
        .map_err(|_| MiCasaGatewayError::InvalidEnvelope)?;
    let nonce = nonce.expect("presence checked");
    let public_relay = public_relay.expect("presence checked");
    let household_authority = clean_authority(household_authority)?;

    if expires < now
        || expires.saturating_sub(now) > MAX_ENVELOPE_TTL_SECONDS
        || !lowercase_hex_64(nonce)
        || !lowercase_hex_64(signature)
        || public_relay != config.public_relay_url
    {
        return Err(MiCasaGatewayError::InvalidEnvelope);
    }

    let canonical = format!(
        "{PURPOSE}\n{household_authority}\n{}\n{expires}\n{nonce}",
        config.public_relay_url
    );
    let signature = hex::decode(signature).map_err(|_| MiCasaGatewayError::InvalidEnvelope)?;
    let mut mac = HmacSha256::new_from_slice(&config.shared_secret)
        .map_err(|_| MiCasaGatewayError::InvalidEnvelope)?;
    mac.update(canonical.as_bytes());
    mac.verify_slice(&signature)
        .map_err(|_| MiCasaGatewayError::InvalidEnvelope)?;
    Ok(Some(config.public_relay_url.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderName, HeaderValue};
    use hmac::Mac;

    const PUBLIC: &str = "wss://micasa.mediaglyphics.com/api/micasa/v1/realtime";
    const AUTHORITY: &str = "household-one.builderlab.example";
    const SECRET_HEX: &str = "6767676767676767676767676767676767676767676767676767676767676767";
    const NONCE: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

    fn config() -> MiCasaGatewayConfig {
        MiCasaGatewayConfig::from_values(Some(PUBLIC.to_string()), Some(SECRET_HEX.to_string()))
            .expect("valid config")
            .expect("enabled")
    }

    fn headers(authority: &str, expires: u64) -> HeaderMap {
        let canonical = format!("{PURPOSE}\n{authority}\n{PUBLIC}\n{expires}\n{NONCE}");
        let secret = hex::decode(SECRET_HEX).unwrap();
        let mut mac = HmacSha256::new_from_slice(&secret).unwrap();
        mac.update(canonical.as_bytes());
        let signature = hex::encode(mac.finalize().into_bytes());
        let mut headers = HeaderMap::new();
        headers.insert(HEADER_AUTHORITY, HeaderValue::from_str(&signature).unwrap());
        headers.insert(
            HEADER_EXPIRES,
            HeaderValue::from_str(&expires.to_string()).unwrap(),
        );
        headers.insert(HEADER_NONCE, HeaderValue::from_static(NONCE));
        headers.insert(HEADER_PUBLIC_RELAY, HeaderValue::from_static(PUBLIC));
        headers
    }

    #[test]
    fn ordinary_direct_connection_keeps_existing_host_binding() {
        assert_eq!(
            authorize_gateway_headers(None, &HeaderMap::new(), AUTHORITY, 1_000),
            Ok(None)
        );
        assert_eq!(
            authorize_gateway_headers(Some(&config()), &HeaderMap::new(), AUTHORITY, 1_000),
            Ok(None)
        );
    }

    #[test]
    fn exact_fresh_envelope_returns_only_configured_public_alias() {
        assert_eq!(
            authorize_gateway_headers(
                Some(&config()),
                &headers(AUTHORITY, 1_030),
                AUTHORITY,
                1_000
            ),
            Ok(Some(PUBLIC.to_string()))
        );
    }

    #[test]
    fn cross_household_replay_is_refused() {
        assert_eq!(
            authorize_gateway_headers(
                Some(&config()),
                &headers(AUTHORITY, 1_030),
                "household-two.builderlab.example",
                1_000,
            ),
            Err(MiCasaGatewayError::InvalidEnvelope)
        );
    }

    #[test]
    fn stale_or_overlong_envelope_is_refused() {
        for expires in [999, 1_031] {
            assert_eq!(
                authorize_gateway_headers(
                    Some(&config()),
                    &headers(AUTHORITY, expires),
                    AUTHORITY,
                    1_000,
                ),
                Err(MiCasaGatewayError::InvalidEnvelope)
            );
        }
    }

    #[test]
    fn partial_duplicate_and_unconfigured_headers_are_refused() {
        let mut partial = HeaderMap::new();
        partial.insert(HEADER_NONCE, HeaderValue::from_static(NONCE));
        assert_eq!(
            authorize_gateway_headers(Some(&config()), &partial, AUTHORITY, 1_000),
            Err(MiCasaGatewayError::InvalidEnvelope)
        );
        assert_eq!(
            authorize_gateway_headers(None, &headers(AUTHORITY, 1_030), AUTHORITY, 1_000),
            Err(MiCasaGatewayError::NotConfigured)
        );
        let mut duplicate = headers(AUTHORITY, 1_030);
        duplicate.append(
            HeaderName::from_static(HEADER_NONCE),
            HeaderValue::from_static(NONCE),
        );
        assert_eq!(
            authorize_gateway_headers(Some(&config()), &duplicate, AUTHORITY, 1_000),
            Err(MiCasaGatewayError::InvalidEnvelope)
        );
    }

    #[test]
    fn forged_signature_nonce_and_public_alias_are_refused() {
        let mut forged = headers(AUTHORITY, 1_030);
        forged.insert(
            HEADER_AUTHORITY,
            HeaderValue::from_static(
                "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            ),
        );
        assert_eq!(
            authorize_gateway_headers(Some(&config()), &forged, AUTHORITY, 1_000),
            Err(MiCasaGatewayError::InvalidEnvelope)
        );

        let mut nonce = headers(AUTHORITY, 1_030);
        nonce.insert(
            HEADER_NONCE,
            HeaderValue::from_static(
                "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
            ),
        );
        assert_eq!(
            authorize_gateway_headers(Some(&config()), &nonce, AUTHORITY, 1_000),
            Err(MiCasaGatewayError::InvalidEnvelope)
        );

        let mut alias = headers(AUTHORITY, 1_030);
        alias.insert(
            HEADER_PUBLIC_RELAY,
            HeaderValue::from_static("wss://other.example/api/micasa/v1/realtime"),
        );
        assert_eq!(
            authorize_gateway_headers(Some(&config()), &alias, AUTHORITY, 1_000),
            Err(MiCasaGatewayError::InvalidEnvelope)
        );
    }

    #[test]
    fn configuration_requires_paired_exact_values() {
        assert!(MiCasaGatewayConfig::from_values(None, None)
            .unwrap()
            .is_none());
        for values in [
            (Some(PUBLIC.to_string()), None),
            (None, Some(SECRET_HEX.to_string())),
        ] {
            assert!(MiCasaGatewayConfig::from_values(values.0, values.1).is_err());
        }
        for url in [
            "ws://micasa.mediaglyphics.com/api/micasa/v1/realtime",
            "wss://micasa.mediaglyphics.com/",
            "wss://micasa.mediaglyphics.com/api/micasa/v1/realtime?target=x",
            "wss://user@micasa.mediaglyphics.com/api/micasa/v1/realtime",
        ] {
            assert!(MiCasaGatewayConfig::from_values(
                Some(url.to_string()),
                Some(SECRET_HEX.to_string())
            )
            .is_err());
        }
        assert!(
            MiCasaGatewayConfig::from_values(Some(PUBLIC.to_string()), Some("a".repeat(63)))
                .is_err()
        );
    }

    #[test]
    fn debug_output_redacts_shared_secret() {
        let rendered = format!("{:?}", config());
        assert!(rendered.contains(PUBLIC));
        assert!(rendered.contains("[REDACTED]"));
        assert!(!rendered.contains(SECRET_HEX));
    }
}
