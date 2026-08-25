# Buzz Agent Activity and Media Perception Specification

## Status

This document defines the product and security contract for agent activity,
media upload, and agent perception of attachments in Buzz. It distinguishes
existing behavior from required future behavior so a transport capability is
not mistaken for verified agent understanding.

The desktop preview features in `preview-features.json` are default-on. Users
may still explicitly disable an individual preview in Settings. Agent working
status and its activity transcript are stable surfaces and do not require a
preview flag.

Buzz currently transports and renders several media types, but transport does
not by itself authorize an agent to retrieve, inspect, retain, or learn from an
attachment. The following requirements govern that perception boundary.

## Required Attachment Perception Contract

### 1. Verified attachment metadata and authenticated retrieval

The perception path MUST parse only well-formed, signed `imeta` metadata and
MUST retrieve attachment bytes through an authenticated Buzz relay or another
explicitly trusted storage boundary. Message text, filenames, and arbitrary
URLs MUST NOT be treated as attachment authority.

### 2. Content, scope, and resource validation

Before decoding content, the path MUST verify the declared digest, detected
MIME type, byte and processing limits, uploader identity, channel scope, and
the requesting agent's current access. A mismatch, missing proof, expired
authorization, or unsupported type MUST fail closed without model exposure.

### 3. Image perception

Supported still images MUST be passed to an approved vision-capable model as
bounded image content, not represented only as an untrusted URL. Derived
descriptions and observations MUST remain scoped to the channel and requesting
principal that authorized the read.

### 4. Animated GIF perception

GIF support MUST use bounded representative-frame extraction with explicit
frame, duration, dimension, and decode limits. Upload acceptance and display
support MUST NOT be interpreted as proof that an agent inspected the
animation. GIF search or provider access requires a separately governed
adapter; Buzz MUST NOT grant arbitrary provider fetch authority.

### 5. Video and audio perception on DeepThought

Video frame sampling, audio extraction, speech recognition, and media
indexing MUST execute on the DeepThought GPU plane. The Mac MUST NOT become a
fallback compute or retention tier. If DeepThought is unavailable, the
perception request MUST return a typed unavailable result and leave the media
unprocessed.

### 6. Document perception

PDF and document inspection MUST use sandboxed extraction with strict parser,
page, text, archive, recursion, and execution limits. Page rendering and OCR
MUST run on the approved isolated media-processing plane. Embedded scripts,
macros, links, and instructions are data only and MUST NOT acquire tool or
prompt authority.

### 7. Provenance and durable evidence

Every derived observation MUST bind the source event, attachment digest,
verified MIME type, extraction method and version, processing plane, access
scope, clocks, and verifier result. Durable records SHOULD retain references,
digests, and bounded derived facts rather than raw private media or transcript
content. Learning and downstream actions MUST cite this provenance.

### 8. No arbitrary fetch and no local spill

Agents MUST NOT fetch arbitrary attachment URLs, follow redirects into private
networks, or bypass relay authorization. Retrieval MUST be SSRF-safe and
allowlisted. Large or growing media, frames, transcripts, OCR output, and
indexes MUST remain DeepThought-only. Temporary local material MUST be bounded,
encrypted where applicable, deleted after processing, and never become a Mac
retention fallback.

## Agent Activity Surface

Working state SHOULD be derived from authenticated agent observer frames, with
channel-scoped typing as a bounded fallback. The UI MAY expose a compact
working pill and an owner-readable activity transcript, but it MUST NOT expose
private prompts, secrets, hidden reasoning, cross-channel content, or another
principal's transcript. Activity history is operational evidence, not model
chain-of-thought.

## Feature-Gate Policy

Preview flags control product exposure, not security authority. Enabling a
flag MUST NOT bypass attachment validation, channel authorization, processing
placement, model capability checks, or provenance requirements. New flags for
GIF upload or agent attachment perception MUST remain unavailable until their
corresponding acceptance tests prove this specification end to end.

## Minimum Acceptance Evidence

An attachment-perception implementation is complete only when tests prove:

- authorized image, GIF, video, audio, PDF, and document paths within bounds;
- digest, MIME, size, identity, channel, expiry, and tamper refusal;
- no arbitrary URL, redirect, SSRF, embedded-script, or prompt-injection
  authority;
- DeepThought GPU execution for media indexing, ASR, OCR, and frame work, with
  typed failure and no Mac fallback;
- provenance-bound results and principal-scoped retention/deletion; and
- an agent can use verified derived evidence while unauthorized agents and
  channels cannot read or reuse it.
