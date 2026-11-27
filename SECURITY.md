# Security Policy

## Scope

fleet-ops acts on GitHub repositories with a GitHub App and pushes copies to GitLab. A flaw here could merge, delete or publish something it should not. Issues in scope include:

- A webhook or Discord request accepted without a valid signature
- A slash command run by someone outside the owner allowlist
- A Dependabot pull request merged outside the documented policy, for example a major npm update
- The drift audit changing a setting when it should only report
- A branch deleted that still has an open pull request or unmerged work
- A token, private key or GitLab credential written to a log, an error or a backup file
- A private repository mirrored to GitLab as public

## Out of scope

- Problems in GitHub, GitLab, Discord or Cloudflare themselves
- Findings that need access to the deployed secrets or the GitHub App's private key
- Rate limits being reached on a very large fleet

## Verifying a release

From 2.0.0, every release carries the source archive, a `SHA256SUMS` file and a build provenance signed through Sigstore by the release workflow. The runner image in GitHub Container Registry has its own attestation.

```sh
gh release download v2.0.0 --repo zaccesss/fleet-ops
sha256sum -c SHA256SUMS
gh attestation verify fleet-ops-v2.0.0.tar.gz --repo zaccesss/fleet-ops
gh attestation verify oci://ghcr.io/zaccesss/fleet-ops-runner:2.0.0 --repo zaccesss/fleet-ops
```

A verified attestation proves the file was built by this repository's release workflow from the tagged commit.

## Supported versions

Only the latest release and the `main` branch get security fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately instead:

- Email: security@isaacadjei.me
- GitHub: [report a vulnerability](https://github.com/zaccesss/fleet-ops/security/advisories/new)

Please include the version or commit, the steps to reproduce and what an attacker could achieve. Expect a reply within 7 days and a fix within 14 days of confirmation where one is possible.

## The shared policy

> [!NOTE]
> The full policy, covering scope, the disclosure process and expected response times, is in [zaccesss/security-policy](https://github.com/zaccesss/security-policy) and on [isaacadjei.me/security-policy](https://isaacadjei.me/security-policy). This file takes precedence where the two differ.
