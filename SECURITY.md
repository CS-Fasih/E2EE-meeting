# How Baithak protects a meeting

This document explains exactly what Baithak encrypts, what other parties can still see, and where the limits are. If you find a problem, please read [Reporting a vulnerability](#reporting-a-vulnerability) at the end.

## Summary

- There is **no Baithak server**. Nobody operates a service that can see or record meetings.
- Every key comes from the **meeting code**, a random 120-bit secret made on the device that starts the meeting. The app never sends the code anywhere.
- Devices find each other through **public relays** (Nostr relays, or your own). Everything sent through them is **sealed with AES-256-GCM** using a key derived from the code, so relays can neither read nor forge it.
- Voice, video, chat and files travel **directly between devices** over WebRTC, protected by **DTLS-SRTP**. Because the connection offers (which carry the DTLS certificate fingerprints) were sealed with the meeting key, an outsider cannot insert themselves into the connection.
- On top of that, **every encoded audio and video frame is encrypted again with AES-256-GCM** with a separate key for each direction of each connection.
- Each connection shows a **safety number and pattern** derived from both sides' DTLS fingerprints. If both people see the same one, there is no one in the middle.

## Keys

| What | How it is made |
|---|---|
| Meeting secret | 15 random bytes from the system CSPRNG, shown as 24 base32 characters |
| Relay topic | HKDF-SHA-256(secret, info `relay-topic`), 16 bytes. The only thing relays use to route messages |
| Password stretch (optional) | PBKDF2-SHA-256, 600,000 iterations, salt bound to the topic |
| Signalling key | HKDF-SHA-256(secret ‖ password stretch, info `signalling-key`) → AES-256-GCM |
| Frame base key | HKDF-SHA-256(secret ‖ password stretch, info `frame-key`) |
| Frame key, A → B | HKDF-SHA-256(frame base key, info `A>B`), where A and B are random per-session participant ids |

Keys exist only in memory and are discarded when the meeting ends.

## Signalling (through relays)

Each message is a JSON object `{type, from, to, timestamp, nonce, body}` sealed with AES-256-GCM (random 96-bit IV, the topic as associated data). Receivers:

- drop anything that does not decrypt,
- drop messages addressed to someone else,
- drop messages older than 10 minutes or whose nonce they have already seen (replay protection).

The sealed envelope is wrapped in an ephemeral Nostr event (kind 25051) signed with a throwaway key pair that is generated per session, so sessions cannot be linked through the relay protocol. Ephemeral events are forwarded but not stored by relays. The app checks event ids and signatures itself rather than trusting relays.

## Media and data

- WebRTC connections use DTLS 1.2+ with SRTP for media and SCTP over DTLS for the data channel (chat, files, reactions, status).
- Frame encryption runs in a Web Worker using `RTCRtpScriptTransform` (or Chromium's encoded streams API). Each frame is sealed with AES-256-GCM, a random 96-bit IV, and a 16-byte tag. A few leading codec header bytes (1 for Opus, 3 or 10 for VP8) are left readable because the packetiser needs them; they are included as associated data, so they cannot be altered. Video is forced to VP8 while frame encryption is on.
- Frames that fail to decrypt are dropped, never played.
- Files are sent in chunks over the data channel, only to people who choose to download them. Nothing is uploaded anywhere.

## Who can see what

| Party | Can see | Cannot see |
|---|---|---|
| Relays | Your IP address, the opaque topic, message sizes and timing | Names, the meeting code, anything said or shared, who is who |
| STUN servers (default: Cloudflare, Google) | Your IP address, when you connect | Anything about the meeting |
| TURN server (only if you set one) | IP addresses, traffic volume | Media (still encrypted end to end) |
| Your network provider | That you use WebRTC and the relays, traffic volume | Content |
| Other participants | Your name, IP address (unless you use relay-only mode with TURN), and everything you choose to share | Nothing is hidden from people you let into the call |

## Waiting room, lock and removal

Anyone who has the code can ask to join. The waiting room (on by default for meetings you start) means the host decides who gets in, and every participant only accepts connections from people the host admitted. The host can lock the meeting or remove someone. These rules are enforced by every participant's app; a modified app with the meeting code could still attempt to connect, which is why the code should be shared privately and the safety numbers checked for sensitive meetings.

## Things Baithak does not protect against

- **A compromised device.** Malware on your phone or computer can see the screen and hear the microphone.
- **Someone you let in.** Participants can record with another device. Baithak shows when someone records with the app, but cannot stop other methods.
- **Metadata from IP addresses.** Use a VPN or Tor-routed network plus a TURN server in "Hide my IP address" mode if this matters.
- **Large meetings.** Everyone connects to everyone (a mesh), so meetings are limited to 8 people. There is no media server, which is the point.
- **A leaked code without the waiting room.** Turn the waiting room on and use a meeting password for sensitive calls.

## Other choices made for privacy

- No accounts, analytics, crash reporting, ads or auto-updates. No third-party scripts, fonts or images: everything is bundled.
- Strict Content Security Policy in every build; the desktop and Android apps refuse to load anything from the internet except relay connections.
- Desktop: sandboxed renderer, context isolation, no Node.js in the page, spellchecker disabled (it would download dictionaries), only camera/microphone/screen permissions are ever granted.
- Android: WebView usage metrics and Safe Browsing lookups turned off, cleartext traffic forbidden, backups disabled, screenshots blocked by default (can be turned off in Settings), and the camera and microphone are released whenever the app is in the background outside a meeting.
- Chat and files are kept in memory only and erased when you leave.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue. Include steps to reproduce if you can.
