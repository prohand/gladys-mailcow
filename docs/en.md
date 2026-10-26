# Mailcow for Gladys Assistant

Watch your [mailcow: dockerized](https://mailcow.email) mail server from Gladys: containers,
mail queue, quarantine, banned IPs, storage, domains and mailboxes — with scene triggers, scene
actions and dashboard widgets.

Requires **Gladys 5.3 or later** and a mailcow API key.

## 1. Create an API key in mailcow

1. Log in to the mailcow web interface as an administrator.
2. Open **System → Configuration → Access → Administrators**, then unfold **API**.
3. Choose the key:
   - **Read-only**: enough to watch the server (recommended);
   - **Read-write**: needed only if you want Gladys to flush the queue or turn domains and
     mailboxes on and off.
4. In **Allow API access from these IPs/CIDR**, add the IP address Gladys reaches mailcow from
   (the IP of the Gladys host, or its public IP if mailcow is on the internet).
5. Tick **Activate API** and save. Copy the key.

> If the IP is missing, mailcow answers "api access denied for ip …": **Test the connection**
> shows that IP, add it to the list.

## 2. Configure the integration

| Field                                    | What to put                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| LAN address                              | mailcow on your network, e.g. `https://192.168.1.20`. Empty if mailcow is elsewhere.            |
| Public address                           | mailcow on the internet, e.g. `https://mail.example.com`.                                       |
| API key                                  | The key copied above.                                                                           |
| Check the certificate of the LAN address | Untick it when the LAN address is an IP (the certificate names the domain).                     |
| Refresh interval (s)                     | How often the server is read: 60 s to 1 h, 300 s by default.                                    |
| One device per domain                    | On by default.                                                                                  |
| One device per mailbox                   | Off by default; for a server with a few mailboxes (200 at most).                                |
| Allow changes                            | Off by default. On (with a read-write key): flush the queue, turn domains/mailboxes on and off. |
| Thresholds                               | Queue (20 mails), storage (85 %), mailbox quota (90 %): used by the scene triggers.             |
| Detailed logs                            | Logs every read. The API key is never logged.                                                   |

Then click **Test the connection**: it reads the server and sums it up (version, containers,
queue, quarantine, storage, domains, mailboxes), or says what is wrong.

## 3. Local and cloud

The integration knows two ways to reach mailcow:

- the **LAN address** is the `local` transport;
- the **public address** is the `cloud` transport (a server at a hosting provider, or your own
  server reached over the internet).

Give one or both. With both, the **Prefer the local connection** switch (shown by Gladys)
chooses which one is tried first; the other one is the fallback. Every device shows a badge with
the address that answered. When the fallback is used, the badge is **degraded** (orange dot):
it works, but not through the preferred address.

The certificate of the public address is always checked. Only the LAN address can skip the
check.

## 4. Devices

Open **Integrations → Mailcow → Discovery** to create them.

**mailcow server** (always): containers running, containers down, mail queue, quarantine,
banned IPs, mail storage used (GB and %), domains, mailboxes, mailcow version.

**mailcow &lt;domain&gt;** (one per domain): active (switch), mailboxes, aliases, messages,
storage used.

**&lt;mailbox address&gt;** (one per mailbox, if enabled): active (switch), quota used (%),
storage used, messages.

The **active** switches can be used from Gladys only when **Allow changes** is on; otherwise they
are read-only.

## 5. Scene triggers

In a scene, pick **Integrations → Mailcow**. A trigger fires when something _changes_ between
two reads: the first read after a start never fires anything.

| Trigger                              | Key                   | Filters         | Variables                                          |
| ------------------------------------ | --------------------- | --------------- | -------------------------------------------------- |
| A mailcow container stopped          | `container_down`      | container       | `container`, `state`                               |
| A mailcow container is running again | `container_up`        | container       | `container`                                        |
| Mail queue too long                  | `queue_high`          | –               | `queue_size`, `threshold`                          |
| Mail storage almost full             | `storage_high`        | –               | `used_percent`, `threshold`                        |
| Mailbox almost full                  | `quota_high`          | domain, mailbox | `mailbox`, `domain`, `percent`, `threshold`        |
| A mail was quarantined               | `quarantine_new`      | recipient       | `sender`, `recipient`, `subject`, `score`, `virus` |
| An IP was banned                     | `ip_banned`           | –               | `ip`                                               |
| mailcow server unreachable           | `connection_lost`     | –               | `reason`, `message`                                |
| mailcow server reachable again       | `connection_restored` | –               | `transport`                                        |

The thresholds fire once, when the value goes over them. Use the variables in the next actions,
e.g. a message `{{triggerEvent.data.container}} is down`. At most 10 events of one kind are sent
per read (a spam wave does not flood your scenes).

## 6. Scene actions

| Action                      | Key                  | Fields                  | Outputs                                                                       |
| --------------------------- | -------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| Read the mailcow server now | `refresh`            | –                       | `reachable`, `queue_size`, `quarantine`, `containers_down`, `storage_percent` |
| Flush the mail queue        | `flush_queue`        | –                       | `queued_before`                                                               |
| Turn a mailbox on or off    | `set_mailbox_active` | mailbox address, active | `changed`                                                                     |

`flush_queue` and `set_mailbox_active` need **Allow changes** and a read-write key.

## 7. Dashboard widgets

- **mailcow server**: address used, version, containers, stopped containers, queue, storage
  gauge, quarantine and banned IPs, a **Refresh** button, a **Flush queue** button (when changes
  are allowed, with a confirmation) and a link to mailcow.
- **mailcow quarantine**: the last quarantined mails (subject, sender, recipient, score or
  virus). Setting: number of mails (1 to 8).
- **mailcow mailboxes**: the mailboxes closest to their quota. Settings: number (1 to 10) and an
  optional domain.

## 8. Troubleshooting

| Message                             | What to do                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| The mailcow server does not answer  | Check the address and that Gladys can reach it (firewall, DNS).                        |
| The HTTPS certificate is refused    | For a LAN address written as an IP, untick "Check the certificate of the LAN address". |
| The API key is refused              | Copy the key again; check that the API is activated.                                   |
| mailcow refuses the API to the IP … | Add that IP to "Allow API access from these IPs/CIDR".                                 |
| Something answered, but not the API | Give the address of the mailcow web interface, without any path.                       |
| Changes are turned off              | Tick "Allow changes" and use the read-write key.                                       |
| This API key is read-only           | Use the read-write key for changes.                                                    |

A section mailcow does not answer (an older version, for instance) is simply left out: the rest
is still read, and **Test the connection** lists what was not read.
