# New Eden Sage Online transport contract

## Design rule

Application data sent between New Eden Sage and Sage Online uses readable HTTPS JSON. Packet bodies must use named fields and a versioned envelope. Do not use positional arrays, packed binary payloads, protobuf, or opaque application blobs unless a future feature has a demonstrated technical need.

HTTPS still encrypts traffic on the network. "Readable" means that when the application-level request is inspected in a debugger, proxy, Worker trace, or development tool, the non-secret data has clear names and structure.

## Packet envelope

```json
{
  "schema": "new-eden-sage.packet.v1",
  "packet_id": "8cbb3bf4-9ab2-4d37-b515-a30edbbd10e1",
  "message_type": "identity.link_character",
  "sent_at": "2026-08-19T04:21:00.000Z",
  "client": {
    "application": "New Eden Sage",
    "component": "desktop",
    "transport": "https-json"
  },
  "payload": {
    "action": "link_verified_eve_character",
    "relationship": "linked_character"
  }
}
```

Every body field should be understandable without source-code archaeology. Future doctrine, fleet, route, corporation, structure, wormhole, giveaway, and notification messages should reuse this envelope.

## Secrets and authentication

Authentication is deliberately excluded from the readable payload:

- EVE access tokens remain in authorization headers.
- Sage Online session tokens remain in authorization headers.
- Refresh tokens remain encrypted on the local PC and are not sent to Sage Online.
- Tokens, secrets, credentials, authorization headers, and encrypted values must never be written to diagnostic logs.

Human-readable transport does not mean human-readable credentials.

## Response correlation

Responses to packet-based requests include transport metadata with the packet schema, a `reply_to` packet ID, and the result message type so a request can be followed without exposing credentials.

## Compatibility

`new-eden-sage.packet.v1` is the first transport schema. Breaking transport changes require a new schema identifier rather than silently changing the meaning of existing fields.
