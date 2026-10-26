# Mailcow para Gladys Assistant

Supervise su servidor de correo [mailcow: dockerized](https://mailcow.email) desde Gladys:
contenedores, cola de correo, cuarentena, IP bloqueadas, almacenamiento, dominios y buzones — con
disparadores de escena, acciones de escena y widgets para el panel.

Necesita **Gladys 5.3 o posterior** y una clave de API de mailcow.

## 1. Crear una clave de API en mailcow

1. Inicie sesión en la interfaz web de mailcow como administrador.
2. Abra **Sistema → Configuración → Acceso → Administradores** y despliegue **API**.
3. Elija la clave:
   - **Solo lectura**: basta para supervisar el servidor (recomendado);
   - **Lectura y escritura**: solo si Gladys debe vaciar la cola o activar y desactivar
     dominios y buzones.
4. En **Permitir acceso a la API desde estas IP/CIDR**, añada la dirección IP desde la que
   Gladys llega a mailcow (la IP del equipo de Gladys, o su IP pública si mailcow está en
   internet).
5. Marque **Activar API** y guarde. Copie la clave.

> Si falta la IP, mailcow responde «api access denied for ip …»: **Probar la conexión** muestra
> esa IP, añádala a la lista.

## 2. Configurar la integración

| Campo                                          | Qué poner                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Dirección local                                | mailcow en su red, p. ej. `https://192.168.1.20`. Vacío si mailcow está en otro sitio.                             |
| Dirección pública                              | mailcow en internet, p. ej. `https://mail.ejemplo.es`.                                                             |
| Clave de API                                   | La clave copiada arriba.                                                                                           |
| Verificar el certificado de la dirección local | Desmárquelo si la dirección local es una IP (el certificado nombra el dominio).                                    |
| Intervalo de actualización (s)                 | Frecuencia de lectura del servidor: de 60 s a 1 h, 300 s por defecto.                                              |
| Un dispositivo por dominio                     | Activado por defecto.                                                                                              |
| Un dispositivo por buzón                       | Desactivado por defecto; para un servidor con pocos buzones (200 como máximo).                                     |
| Permitir cambios                               | Desactivado por defecto. Activado (con clave de escritura): vaciar la cola, activar/desactivar dominios y buzones. |
| Umbrales                                       | Cola (20 correos), almacenamiento (85 %), cuota de buzones (90 %): para los disparadores.                          |
| Registros detallados                           | Registra cada lectura. La clave de API nunca se registra.                                                          |

Pulse luego **Probar la conexión**: lee el servidor y lo resume (versión, contenedores, cola,
cuarentena, almacenamiento, dominios, buzones), o dice qué falla.

## 3. Local y cloud

La integración conoce dos caminos hacia mailcow:

- la **dirección local** es el transporte `local`;
- la **dirección pública** es el transporte `cloud` (un servidor en un proveedor de alojamiento,
  o su propio servidor accedido por internet).

Indique una o ambas. Con ambas, el interruptor **Preferir la conexión local** (mostrado por
Gladys) elige cuál se prueba primero; la otra sirve de respaldo. Cada dispositivo muestra una
insignia con la dirección que respondió. Cuando se usa el respaldo, la insignia está
**degradada** (punto naranja): funciona, pero no por la dirección preferida.

El certificado de la dirección pública siempre se verifica. Solo la dirección local puede omitir
la verificación.

## 4. Dispositivos

Abra **Integraciones → Mailcow → Descubrimiento** para crearlos.

**mailcow server** (siempre): contenedores en marcha, contenedores detenidos, cola de correo,
cuarentena, IP bloqueadas, almacenamiento de correo usado (GB y %), dominios, buzones, versión de
mailcow.

**mailcow &lt;dominio&gt;** (uno por dominio): activo (interruptor), buzones, alias, mensajes,
almacenamiento usado.

**&lt;dirección del buzón&gt;** (uno por buzón, si está activado): activo (interruptor), cuota
usada (%), almacenamiento usado, mensajes.

Los interruptores **activo** solo se pueden usar desde Gladys si **Permitir cambios** está
activado; si no, son de solo lectura.

## 5. Disparadores de escena

En una escena, elija **Integraciones → Mailcow**. Un disparador se activa cuando algo _cambia_
entre dos lecturas: la primera lectura tras un arranque nunca activa nada.

| Disparador                                  | Clave                 | Filtros        | Variables                                          |
| ------------------------------------------- | --------------------- | -------------- | -------------------------------------------------- |
| Se ha detenido un contenedor de mailcow     | `container_down`      | contenedor     | `container`, `state`                               |
| Un contenedor de mailcow vuelve a funcionar | `container_up`        | contenedor     | `container`                                        |
| Cola de correo demasiado larga              | `queue_high`          | –              | `queue_size`, `threshold`                          |
| Almacenamiento casi lleno                   | `storage_high`        | –              | `used_percent`, `threshold`                        |
| Buzón casi lleno                            | `quota_high`          | dominio, buzón | `mailbox`, `domain`, `percent`, `threshold`        |
| Se ha puesto un correo en cuarentena        | `quarantine_new`      | destinatario   | `sender`, `recipient`, `subject`, `score`, `virus` |
| Se ha bloqueado una IP                      | `ip_banned`           | –              | `ip`                                               |
| Servidor mailcow inaccesible                | `connection_lost`     | –              | `reason`, `message`                                |
| Servidor mailcow accesible de nuevo         | `connection_restored` | –              | `transport`                                        |

Los umbrales se activan una vez, cuando el valor los supera. Use las variables en las acciones
siguientes, p. ej. un mensaje `{{triggerEvent.data.container}} está detenido`. Se envían como
máximo 10 eventos de un mismo tipo por lectura (una ola de spam no inunda sus escenas).

## 6. Acciones de escena

| Acción                         | Clave                | Campos                      | Salidas                                                                       |
| ------------------------------ | -------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Leer el servidor mailcow ahora | `refresh`            | –                           | `reachable`, `queue_size`, `quarantine`, `containers_down`, `storage_percent` |
| Vaciar la cola de correo       | `flush_queue`        | –                           | `queued_before`                                                               |
| Activar o desactivar un buzón  | `set_mailbox_active` | dirección del buzón, activo | `changed`                                                                     |

`flush_queue` y `set_mailbox_active` necesitan **Permitir cambios** y una clave de lectura y
escritura.

## 7. Widgets del panel

- **Servidor mailcow**: dirección usada, versión, contenedores, contenedores detenidos, cola,
  indicador de almacenamiento, cuarentena e IP bloqueadas, un botón **Actualizar**, un botón
  **Vaciar la cola** (si los cambios están permitidos, con confirmación) y un enlace a mailcow.
- **Cuarentena mailcow**: los últimos correos en cuarentena (asunto, remitente, destinatario,
  puntuación o virus). Ajuste: número de correos (1 a 8).
- **Buzones mailcow**: los buzones más cerca de su cuota. Ajustes: número (1 a 10) y un dominio
  opcional.

## 8. Solución de problemas

| Mensaje                              | Qué hacer                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| El servidor mailcow no responde      | Compruebe la dirección y que Gladys pueda alcanzarlo (cortafuegos, DNS).                              |
| Se rechaza el certificado HTTPS      | Para una dirección local escrita como IP, desmarque «Verificar el certificado de la dirección local». |
| Se rechaza la clave de API           | Copie de nuevo la clave; compruebe que la API está activada.                                          |
| mailcow niega la API a la IP …       | Añada esa IP en «Permitir acceso a la API desde estas IP/CIDR».                                       |
| Algo ha respondido, pero no la API   | Indique la dirección de la interfaz web de mailcow, sin ruta.                                         |
| Los cambios están desactivados       | Marque «Permitir cambios» y use la clave de lectura y escritura.                                      |
| Esta clave de API es de solo lectura | Use la clave de lectura y escritura para los cambios.                                                 |

Una sección a la que mailcow no responde (una versión antigua, por ejemplo) simplemente se omite:
el resto se lee igualmente, y **Probar la conexión** indica lo que no se ha leído.
