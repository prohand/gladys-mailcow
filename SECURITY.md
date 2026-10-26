# Security policy

## Supported versions

Only the latest release of the mailcow integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-mailcow](https://github.com/prohand/gladys-mailcow/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration, of Gladys and of mailcow;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove API keys, passwords, mail addresses and IP
  addresses first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)), mailcow
itself (report to [mailcow/mailcow-dockerized](https://github.com/mailcow/mailcow-dockerized/security))
and the other third-party services the integration talks to.

## Good practices for users

- Use a **read-only** API key unless you really need Gladys to act on mailcow; keep
  "Allow changes" off otherwise.
- Restrict the API key to the IP Gladys reaches mailcow from ("Allow API access from
  these IPs/CIDR" in mailcow).
- Prefer the LAN address; if mailcow is only reachable over the internet, keep its
  certificate valid (the integration always checks it for the public address).
- Keep Gladys, the integration and mailcow up to date.
