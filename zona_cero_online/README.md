# ZONA CERO — paquete inicial online para itch.io

Este paquete contiene el juego HTML mejorado, un backend Node.js + Socket.IO y un adaptador de cliente.

## Qué incluye ahora
- API de registro e inicio de sesión con contraseñas cifradas (bcrypt).
- Tokens de sesión JWT.
- Persistencia SQLite de cuentas, XP, rango, victorias y derrotas.
- Salas Socket.IO con límite de 30 conexiones y códigos para entrar.
- Eventos básicos para retransmitir la posición/rotación de jugadores.
- Adaptador JavaScript para conectar el HTML al backend.

## Qué NO está terminado todavía
Esto es la **base de red**, no una versión multijugador completa ya integrada. El HTML actual todavía ejecuta la lógica local de partida/bots. Falta conectar el menú de salas y el HUD a `ZonaCeroOnline`, crear avatares remotos dentro de Three.js, sincronizar disparos/daño/loot/zona/fin de partida y validar toda la simulación en el servidor. El guardado de progreso también debe pasar a resultados calculados por el servidor antes de producción; no confíes en valores de XP enviados libremente por el navegador.

## Requisitos
- Node.js 20 o superior.
- Un alojamiento para Node.js que permita WebSockets persistentes.
- Una base de datos persistente/volumen para `zona-cero.sqlite` (SQLite sirve para prototipo o una instancia pequeña; para escalar, migra a PostgreSQL).

## Ejecutar localmente
1. Abre una terminal en `server/`.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env`.
4. Genera un secreto largo para `JWT_SECRET` y configura `CLIENT_ORIGIN` con el origen de tu página de itch.io. Durante pruebas locales puedes usar `http://localhost:8000`.
5. Ejecuta `npm start`.
6. Comprueba `http://localhost:3000/health`.

## Conectar el cliente
En el HTML, antes de cerrar `</body>` y después de cargar Socket.IO client, añade:

```html
<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>
<script>window.ZONA_CERO_SERVER_URL = 'https://TU-SERVIDOR';</script>
<script src="client/multiplayer-client.js"></script>
```

El archivo adaptador se encuentra en `client/multiplayer-client.js`. Ejemplo de uso desde la lógica de interfaz:

```js
const session = await ZonaCeroOnline.login(username, password);
localStorage.setItem('zonaCeroToken', session.token);
const socket = ZonaCeroOnline.connect(session.token);
socket.on('room:state', room => console.log('Sala:', room));
const room = await ZonaCeroOnline.createRoom();
// O: await ZonaCeroOnline.joinRoom('CODIGO');
```

No guardes contraseñas en localStorage. El token es sensible; para un lanzamiento comercial considera cookies seguras o una estrategia de sesión endurecida.

## Publicar en itch.io
- Sube `game.html` y los recursos del cliente como proyecto HTML5/ZIP.
- Despliega `server/` en un proveedor externo compatible con Node.js y WebSockets.
- Usa HTTPS en el backend (Socket.IO cambiará a WSS automáticamente bajo HTTPS).
- Pon el dominio de tu página itch.io en `CLIENT_ORIGIN` y la URL del backend en `window.ZONA_CERO_SERVER_URL`.
- Mantén el backend encendido: subir el HTML a itch.io no inicia ni aloja el servidor Node.

## Seguridad antes de abrir al público
- Mover la autoridad de movimiento, disparos, daño, inventario y resultados al servidor.
- Añadir límites de frecuencia, validación de velocidad/teletransporte y protección anti-trampas.
- Añadir moderación, bloqueo/reporte, límites de intentos y política de privacidad.
- Usar PostgreSQL gestionado y copias de seguridad para cuentas reales.
