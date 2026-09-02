//! Deployment-operator projection of PA-owned system rooms into Buzz channels.
//!
//! Ordinary Buzz channels remain Nostr-first. MiCasa founder provisioning is a
//! narrow exception: the backend must create required system rooms while the
//! founder's private Nostr key remains inside the encrypted browser signer.
//! This endpoint therefore uses the existing deployment-operator NIP-98 gate,
//! accepts only create-only private stream rooms, and atomically installs the
//! founder's public key as the initial owner. It never signs as that founder,
//! converges an existing channel, changes ownership, or accepts a browser
//! credential.

use std::sync::Arc;

use axum::{
    extract::{Query, RawQuery, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use buzz_core::kind::{KIND_NIP29_GROUP_MEMBERS, KIND_NIP29_GROUP_METADATA};
use buzz_core::TenantContext;
use buzz_db::channel::CreateOperatorChannelWithOwnerResult;
use buzz_db::{DbError, EventQuery};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::handlers::community_provisioning::{normalize_candidate_host, validate_pubkey_hex};
use crate::handlers::side_effects::emit_group_discovery_events;
use crate::state::AppState;

use super::operator::authorize_operator_request;
use super::{api_error, internal_error};

const MAX_SYSTEM_ROOM_NAME_BYTES: usize = 80;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
/// Exact read-only selector for one PA-managed system-room channel.
pub struct ObserveOperatorChannelQuery {
    host: String,
    channel_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
/// Create-only request for one locked PA system-room shape.
pub struct CreateOperatorChannelRequest {
    host: String,
    channel_id: String,
    room_kind: String,
    name: String,
    initial_owner_pubkey: String,
    create_only: bool,
}

struct CheckedCreate {
    host: String,
    channel_id: Uuid,
    name: String,
    owner_pubkey: String,
}

fn invalid(message: &str) -> (StatusCode, Json<Value>) {
    api_error(StatusCode::BAD_REQUEST, message)
}

fn checked_host(value: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let normalized = normalize_candidate_host(value).map_err(|_| invalid("invalid host"))?;
    if normalized != value {
        return Err(invalid("host must be canonical"));
    }
    Ok(normalized)
}

fn checked_channel_id(value: &str) -> Result<Uuid, (StatusCode, Json<Value>)> {
    let parsed = Uuid::parse_str(value).map_err(|_| invalid("invalid channel_id"))?;
    if parsed.is_nil() || parsed.to_string() != value {
        return Err(invalid("invalid channel_id"));
    }
    Ok(parsed)
}

fn checked_create(
    request: CreateOperatorChannelRequest,
) -> Result<CheckedCreate, (StatusCode, Json<Value>)> {
    if !request.create_only {
        return Err(invalid("create_only must be true"));
    }
    let expected_name = match request.room_kind.as_str() {
        "household" => "Household",
        "personal_agent" => "My Agent",
        _ => return Err(invalid("invalid room_kind")),
    };
    if request.name != expected_name
        || request.name.len() > MAX_SYSTEM_ROOM_NAME_BYTES
        || request.name.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
    {
        return Err(invalid("invalid name"));
    }
    let owner_pubkey = validate_pubkey_hex(&request.initial_owner_pubkey)
        .ok_or_else(|| invalid("invalid initial_owner_pubkey"))?;
    if owner_pubkey != request.initial_owner_pubkey {
        return Err(invalid("initial_owner_pubkey must be canonical"));
    }
    Ok(CheckedCreate {
        host: checked_host(&request.host)?,
        channel_id: checked_channel_id(&request.channel_id)?,
        name: request.name,
        owner_pubkey,
    })
}

async fn tenant_for_host(
    state: &AppState,
    host: &str,
) -> Result<TenantContext, (StatusCode, Json<Value>)> {
    let record = state
        .db
        .lookup_community_by_host(host)
        .await
        .map_err(|error| internal_error(&format!("operator channel host lookup: {error}")))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "community not found"))?;
    if record.host != host {
        return Err(internal_error("operator channel host mapping mismatch"));
    }
    Ok(TenantContext::resolved(record.id, &record.host))
}

fn exact_tag(event: &nostr::Event, expected: &[&str]) -> bool {
    event.tags.iter().any(|tag| {
        let values = tag.as_slice();
        values.len() == expected.len()
            && values
                .iter()
                .zip(expected)
                .all(|(actual, wanted)| actual == wanted)
    })
}

async fn projection_state(
    state: &AppState,
    tenant: &TenantContext,
    channel_id: Uuid,
    name: &str,
    owner_pubkey: &str,
) -> Result<(bool, bool), (StatusCode, Json<Value>)> {
    let group_id = channel_id.to_string();
    let events = state
        .db
        .query_events(&EventQuery {
            channel_id: Some(channel_id),
            kinds: Some(vec![
                KIND_NIP29_GROUP_METADATA as i32,
                KIND_NIP29_GROUP_MEMBERS as i32,
            ]),
            d_tag: Some(group_id.clone()),
            limit: Some(4),
            ..EventQuery::for_community(tenant.community())
        })
        .await
        .map_err(|error| internal_error(&format!("operator channel projection read: {error}")))?;
    let metadata_ready = events.iter().any(|stored| {
        stored.event.kind.as_u16() as u32 == KIND_NIP29_GROUP_METADATA
            && exact_tag(&stored.event, &["d", &group_id])
            && exact_tag(&stored.event, &["name", name])
            && exact_tag(&stored.event, &["private"])
            && exact_tag(&stored.event, &["closed"])
            && exact_tag(&stored.event, &["t", "stream"])
    });
    let membership_ready = events.iter().any(|stored| {
        stored.event.kind.as_u16() as u32 == KIND_NIP29_GROUP_MEMBERS
            && exact_tag(&stored.event, &["d", &group_id])
            && (exact_tag(&stored.event, &["p", owner_pubkey, "owner"])
                || exact_tag(&stored.event, &["p", owner_pubkey, "", "owner"]))
    });
    Ok((metadata_ready, membership_ready))
}

async fn channel_document(
    state: &AppState,
    tenant: &TenantContext,
    channel_id: Uuid,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let channel = match state.db.get_channel(tenant.community(), channel_id).await {
        Ok(value) => value,
        Err(DbError::ChannelNotFound(_)) => return Ok(Value::Null),
        Err(error) => {
            return Err(internal_error(&format!(
                "operator channel lookup failed: {error}"
            )))
        }
    };
    let members = state
        .db
        .get_members(tenant.community(), channel_id)
        .await
        .map_err(|error| internal_error(&format!("operator channel members: {error}")))?;
    let mut owners: Vec<String> = members
        .iter()
        .filter(|member| member.role == "owner")
        .map(|member| hex::encode(&member.pubkey))
        .collect();
    owners.sort();
    owners.dedup();
    let created_by_pubkey = hex::encode(&channel.created_by);
    let (metadata_ready, membership_ready) =
        projection_state(state, tenant, channel_id, &channel.name, &created_by_pubkey).await?;
    Ok(json!({
        "active_member_count": members.len(),
        "archived_at": channel.archived_at,
        "channel_type": channel.channel_type,
        "created_at": channel.created_at,
        "created_by_pubkey": created_by_pubkey,
        "deleted": false,
        "metadata_projection_ready": metadata_ready,
        "membership_projection_ready": membership_ready,
        "name": channel.name,
        "owner_pubkeys": owners,
        "visibility": channel.visibility,
    }))
}

/// Observe one deterministic PA system-room channel without mutating it.
pub async fn observe_operator_channel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    RawQuery(raw_query): RawQuery,
    Query(query): Query<ObserveOperatorChannelQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    authorize_operator_request(
        &state,
        &headers,
        "GET",
        "/operator/channels",
        raw_query.as_deref(),
        None,
    )
    .await?;
    let host = checked_host(&query.host)?;
    let channel_id = checked_channel_id(&query.channel_id)?;
    let tenant = tenant_for_host(&state, &host).await?;
    let channel = channel_document(&state, &tenant, channel_id).await?;
    Ok(Json(json!({
        "channel": channel,
        "channel_id": channel_id,
        "host": host,
        "schema": "buzz.operator-channel-observation.v1",
    })))
}

/// Create one private PA system-room channel and its initial owner atomically.
pub async fn create_operator_channel(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    authorize_operator_request(
        &state,
        &headers,
        "POST",
        "/operator/channels",
        None,
        Some(&body),
    )
    .await?;
    let request: CreateOperatorChannelRequest =
        serde_json::from_slice(&body).map_err(|_| invalid("invalid operator-channel JSON"))?;
    let checked = checked_create(request)?;
    let tenant = tenant_for_host(&state, &checked.host).await?;
    let owner_bytes =
        hex::decode(&checked.owner_pubkey).map_err(|_| invalid("invalid initial_owner_pubkey"))?;
    let create_result = state
        .db
        .create_operator_channel_with_owner(
            tenant.community(),
            checked.channel_id,
            &checked.name,
            &owner_bytes,
            &state.relay_keypair,
        )
        .await
        .map_err(|error| internal_error(&format!("operator channel create: {error}")))?;
    match create_result {
        CreateOperatorChannelWithOwnerResult::Created(_) => {}
        CreateOperatorChannelWithOwnerResult::ChannelExists => {
            return Err(api_error(StatusCode::CONFLICT, "channel already exists"));
        }
        CreateOperatorChannelWithOwnerResult::OwnerNotCommunityOwner => {
            return Err(api_error(
                StatusCode::CONFLICT,
                "initial owner is not the community owner",
            ));
        }
    }
    state.invalidate_membership(&tenant, checked.channel_id, &owner_bytes);
    emit_group_discovery_events(&tenant, &state, checked.channel_id)
        .await
        .map_err(|error| internal_error(&format!("operator channel projection: {error}")))?;
    let channel = channel_document(&state, &tenant, checked.channel_id).await?;
    let projection_ready = channel.as_object().is_some_and(|value| {
        value.get("metadata_projection_ready") == Some(&Value::Bool(true))
            && value.get("membership_projection_ready") == Some(&Value::Bool(true))
    });
    if !projection_ready {
        return Err(internal_error("operator channel projection incomplete"));
    }
    Ok(Json(json!({
        "channel": channel,
        "channel_id": checked.channel_id,
        "host": checked.host,
        "schema": "buzz.operator-channel-create.v1",
        "status": "created",
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(kind: &str, name: &str) -> CreateOperatorChannelRequest {
        CreateOperatorChannelRequest {
            host: "tenant.communities.buzz.xyz".to_string(),
            channel_id: "5a5d19e2-20a2-5d15-8db7-8a5458ff3f88".to_string(),
            room_kind: kind.to_string(),
            name: name.to_string(),
            initial_owner_pubkey:
                "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798".to_string(),
            create_only: true,
        }
    }

    #[test]
    fn accepts_only_locked_system_room_shapes() {
        let household = checked_create(request("household", "Household")).expect("household room");
        assert_eq!(household.name, "Household");
        let personal =
            checked_create(request("personal_agent", "My Agent")).expect("personal room");
        assert_eq!(personal.name, "My Agent");
    }

    #[test]
    fn refuses_convergence_unknown_kinds_and_name_substitution() {
        let mut converging = request("household", "Household");
        converging.create_only = false;
        assert!(checked_create(converging).is_err());
        assert!(checked_create(request("group", "Family")).is_err());
        assert!(checked_create(request("household", "Welcome")).is_err());
        assert!(checked_create(request("personal_agent", "Household")).is_err());
    }

    #[test]
    fn refuses_noncanonical_host_channel_and_owner() {
        let mut bad_host = request("household", "Household");
        bad_host.host = "Tenant.communities.buzz.xyz".to_string();
        assert!(checked_create(bad_host).is_err());
        let mut bad_channel = request("household", "Household");
        bad_channel.channel_id = Uuid::nil().to_string();
        assert!(checked_create(bad_channel).is_err());
        let mut bad_owner = request("household", "Household");
        bad_owner.initial_owner_pubkey = bad_owner.initial_owner_pubkey.to_uppercase();
        assert!(checked_create(bad_owner).is_err());
    }

    #[test]
    fn serde_refuses_unknown_operator_fields() {
        let raw = json!({
            "channel_id": "5a5d19e2-20a2-5d15-8db7-8a5458ff3f88",
            "create_only": true,
            "host": "tenant.communities.buzz.xyz",
            "initial_owner_pubkey":
                "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
            "name": "Household",
            "room_kind": "household",
            "owner_private_key": "forbidden",
        });
        assert!(serde_json::from_value::<CreateOperatorChannelRequest>(raw).is_err());
    }
}
