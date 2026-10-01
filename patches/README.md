# Dependency patches

## mailauth 5.0.3: portable RSA verification digest

Cloudflare Workers rejects `crypto.verify('rsa-sha256', ...)` with
`Unknown digest: rsa-sha256`. Mailauth catches that exception and reports a
non-passing DKIM result, causing valid bank messages to be rejected.

The patch passes the already validated digest (`sha256` or `sha1`) instead of
the DKIM algorithm name for RSA verification. Node selects RSA from the public
key. Ed25519 verification is unchanged. Message bytes, canonicalization, DNS
keys, signed-header requirements, and all application checks remain unchanged.

Bun applies the patch through `patchedDependencies` during installation. Keep
the patch directory in Docker build contexts before running `bun install`.

Validation: `bun test test/dkim.test.ts` checks the digest passed to crypto,
valid signatures, modified bodies, wrong domains, unsigned or duplicate
recipient headers, and body-length-limited signatures. Runtime reproduction
under workerd also verified the synthetic message and existing local CAKE/Timo
samples; private raw emails are not included in this patch.
