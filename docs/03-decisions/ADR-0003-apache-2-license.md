# ADR-0003 — Apache-2.0 for standard + SDK + adapters

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Rishabh

## Context
Lucid is intended to be an OSS, category-defining project whose strategic moat is *adoption of the HSC standard*. We must pick a license for the standard, SDK, and adapters. All candidates are OSI-approved open source; they differ in how much they compel downstream sharing.

## Options considered
1. **Apache-2.0 (permissive).** Anyone can use/embed/offer as a service without contributing back; explicit patent grant.
   - Pros: maximizes adoption; standard choice for "become-the-standard" infra (OTel, Kubernetes); patent grant matters for a standard.
   - Cons: a competitor could offer a closed managed service without sharing changes.
2. **AGPL-3.0 (network copyleft).** Modified network services must release changes.
   - Pros: closes the SaaS loophole.
   - Cons: many enterprises ban AGPL dependencies → suppresses adoption of a *standard*.
3. **Open-core / dual-license.** Permissive core + commercial premium tier.
   - Pros: built-in commercial wedge.
   - Cons: governance complexity; can chill community contribution to the core.

## Decision
**Apache-2.0** for the standard, SDK, and adapters. Reserve the *option* to offer a future hosted/managed Self-Evolution backend under an **open-core** model — monetize a service, never the protocol.

## Rationale
A restrictive license kills standard adoption, and adoption is the moat. License the standard and plumbing as liberally as possible to win the category; the patent grant protects the standard; any commercial tier rides on a managed service, not the protocol.

## Consequences
- The standard + SDK + adapters are permissively usable by anyone, including potential competitors.
- A future managed tier requires a deliberate open-core boundary decision (separate ADR when relevant).

## Developer impact
Developers and companies can adopt, embed, and ship Lucid with zero licensing friction — the key to making HSC ubiquitous.
