# Mailcow pour Gladys Assistant

Surveillez votre serveur mail [mailcow: dockerized](https://mailcow.email) depuis Gladys :
conteneurs, file d'attente, quarantaine, IP bannies, stockage, domaines et boîtes mail — avec des
déclencheurs de scène, des actions de scène et des widgets de tableau de bord.

Nécessite **Gladys 5.3 ou plus récent** et une clé d'API mailcow.

## 1. Créer une clé d'API dans mailcow

1. Connectez-vous à l'interface web de mailcow en administrateur.
2. Ouvrez **Système → Configuration → Accès → Administrateurs**, puis dépliez **API**.
3. Choisissez la clé :
   - **Lecture seule** : suffit pour surveiller le serveur (recommandé) ;
   - **Lecture-écriture** : seulement si Gladys doit vider la file ou activer/désactiver
     domaines et boîtes mail.
4. Dans **Autoriser l'accès API depuis ces IP/CIDR**, ajoutez l'adresse IP depuis laquelle Gladys
   joint mailcow (l'IP de la machine Gladys, ou son IP publique si mailcow est sur internet).
5. Cochez **Activer l'API** et enregistrez. Copiez la clé.

> Si l'IP manque, mailcow répond « api access denied for ip … » : **Tester la connexion** affiche
> cette IP, ajoutez-la à la liste.

## 2. Configurer l'intégration

| Champ                                      | Quoi mettre                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Adresse locale                             | mailcow sur votre réseau, ex. `https://192.168.1.20`. Vide si mailcow est ailleurs.                                  |
| Adresse publique                           | mailcow sur internet, ex. `https://mail.exemple.fr`.                                                                 |
| Clé d'API                                  | La clé copiée plus haut.                                                                                             |
| Vérifier le certificat de l'adresse locale | À décocher si l'adresse locale est une IP (le certificat nomme le domaine).                                          |
| Intervalle de rafraîchissement (s)         | Fréquence de lecture du serveur : de 60 s à 1 h, 300 s par défaut.                                                   |
| Un appareil par domaine                    | Activé par défaut.                                                                                                   |
| Un appareil par boîte mail                 | Désactivé par défaut ; pour un serveur avec peu de boîtes (200 au plus).                                             |
| Autoriser les modifications                | Désactivé par défaut. Activé (avec une clé lecture-écriture) : vider la file, activer/désactiver domaines et boîtes. |
| Seuils                                     | File (20 mails), stockage (85 %), quota des boîtes (90 %) : utilisés par les déclencheurs.                           |
| Journaux détaillés                         | Journalise chaque lecture. La clé d'API n'est jamais journalisée.                                                    |

Cliquez ensuite sur **Tester la connexion** : il lit le serveur et le résume (version,
conteneurs, file, quarantaine, stockage, domaines, boîtes), ou dit ce qui ne va pas.

## 3. Local et cloud

L'intégration connaît deux chemins vers mailcow :

- l'**adresse locale** est le transport `local` ;
- l'**adresse publique** est le transport `cloud` (un serveur chez un hébergeur, ou votre serveur
  joint par internet).

Indiquez l'une, l'autre ou les deux. Avec les deux, l'interrupteur **Préférer la connexion
locale** (affiché par Gladys) choisit celle essayée en premier ; l'autre sert de secours. Chaque
appareil affiche un badge avec l'adresse qui a répondu. Quand le secours est utilisé, le badge
est **dégradé** (point orange) : ça marche, mais pas par l'adresse préférée.

Le certificat de l'adresse publique est toujours vérifié. Seule l'adresse locale peut s'en
passer.

## 4. Appareils

Ouvrez **Intégrations → Mailcow → Découverte** pour les créer.

**mailcow server** (toujours) : conteneurs en marche, conteneurs arrêtés, file d'attente,
quarantaine, IP bannies, stockage des mails (Go et %), domaines, boîtes mail, version de mailcow.

**mailcow &lt;domaine&gt;** (un par domaine) : actif (interrupteur), boîtes mail, alias, messages,
stockage utilisé.

**&lt;adresse de la boîte&gt;** (un par boîte, si activé) : active (interrupteur), quota utilisé
(%), stockage utilisé, messages.

Les interrupteurs **actif** ne sont utilisables depuis Gladys que si **Autoriser les
modifications** est activé ; sinon ils sont en lecture seule.

## 5. Déclencheurs de scène

Dans une scène, choisissez **Intégrations → Mailcow**. Un déclencheur part quand quelque chose
_change_ entre deux lectures : la première lecture après un démarrage ne déclenche jamais rien.

| Déclencheur                           | Clé                   | Filtres        | Variables                                          |
| ------------------------------------- | --------------------- | -------------- | -------------------------------------------------- |
| Un conteneur mailcow s'est arrêté     | `container_down`      | conteneur      | `container`, `state`                               |
| Un conteneur mailcow tourne à nouveau | `container_up`        | conteneur      | `container`                                        |
| File d'attente trop longue            | `queue_high`          | –              | `queue_size`, `threshold`                          |
| Stockage presque plein                | `storage_high`        | –              | `used_percent`, `threshold`                        |
| Boîte mail presque pleine             | `quota_high`          | domaine, boîte | `mailbox`, `domain`, `percent`, `threshold`        |
| Un mail a été mis en quarantaine      | `quarantine_new`      | destinataire   | `sender`, `recipient`, `subject`, `score`, `virus` |
| Une IP a été bannie                   | `ip_banned`           | –              | `ip`                                               |
| Serveur mailcow injoignable           | `connection_lost`     | –              | `reason`, `message`                                |
| Serveur mailcow à nouveau joignable   | `connection_restored` | –              | `transport`                                        |

Les seuils se déclenchent une fois, quand la valeur les dépasse. Utilisez les variables dans les
actions suivantes, par exemple un message `{{triggerEvent.data.container}} est arrêté`. Au plus
10 événements d'un même type sont envoyés par lecture (une vague de spam n'inonde pas vos
scènes).

## 6. Actions de scène

| Action                               | Clé                  | Champs                      | Sorties                                                                       |
| ------------------------------------ | -------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Lire le serveur mailcow maintenant   | `refresh`            | –                           | `reachable`, `queue_size`, `quarantine`, `containers_down`, `storage_percent` |
| Vider la file d'attente              | `flush_queue`        | –                           | `queued_before`                                                               |
| Activer ou désactiver une boîte mail | `set_mailbox_active` | adresse de la boîte, active | `changed`                                                                     |

`flush_queue` et `set_mailbox_active` demandent **Autoriser les modifications** et une clé en
lecture-écriture.

## 7. Widgets du tableau de bord

- **Serveur mailcow** : adresse utilisée, version, conteneurs, conteneurs arrêtés, file, jauge du
  stockage, quarantaine et IP bannies, un bouton **Actualiser**, un bouton **Vider la file**
  (si les modifications sont autorisées, avec confirmation) et un lien vers mailcow.
- **Quarantaine mailcow** : les derniers mails en quarantaine (objet, expéditeur, destinataire,
  score ou virus). Réglage : nombre de mails (1 à 8).
- **Boîtes mail mailcow** : les boîtes les plus proches de leur quota. Réglages : nombre (1 à 10)
  et un domaine facultatif.

## 8. Dépannage

| Message                                 | Que faire                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Le serveur mailcow ne répond pas        | Vérifiez l'adresse et que Gladys peut le joindre (pare-feu, DNS).                              |
| Le certificat HTTPS est refusé          | Pour une adresse locale écrite en IP, décochez « Vérifier le certificat de l'adresse locale ». |
| La clé d'API est refusée                | Recopiez la clé ; vérifiez que l'API est activée.                                              |
| mailcow refuse l'API à l'IP …           | Ajoutez cette IP dans « Autoriser l'accès API depuis ces IP/CIDR ».                            |
| Quelque chose a répondu, mais pas l'API | Indiquez l'adresse de l'interface web de mailcow, sans chemin.                                 |
| Les modifications sont désactivées      | Cochez « Autoriser les modifications » et utilisez la clé lecture-écriture.                    |
| Cette clé d'API est en lecture seule    | Utilisez la clé lecture-écriture pour les modifications.                                       |

Une partie à laquelle mailcow ne répond pas (une version ancienne, par exemple) est simplement
ignorée : le reste est lu quand même, et **Tester la connexion** liste ce qui n'a pas été lu.
