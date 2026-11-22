/* Adaptador cliente para incluir en game.html después de socket.io.client.
   Configura window.ZONA_CERO_SERVER_URL con la URL HTTPS/WSS del backend desplegado. */
(() => {
  const api = () => window.ZONA_CERO_SERVER_URL;
  let socket = null;
  const request = async (path, method, body, token) => {
    if (!api()) throw new Error('Falta configurar ZONA_CERO_SERVER_URL.');
    const r = await fetch(api() + path, { method, headers: { 'Content-Type':'application/json', ...(token ? { Authorization:'Bearer '+token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Error del servidor'); return data;
  };
  window.ZonaCeroOnline = {
    register: (username,password) => request('/api/register','POST',{username,password}),
    login: (username,password) => request('/api/login','POST',{username,password}),
    me: token => request('/api/me','GET',null,token),
    saveProgress: (token,progress) => request('/api/progress','PUT',progress,token),
    connect(token) {
      if (!window.io) throw new Error('No se ha cargado Socket.IO client.');
      socket = window.io(api(), { transports:['websocket','polling'], auth:{ token } });
      return socket;
    },
    createRoom() { return new Promise((resolve,reject) => { if (!socket) return reject(new Error('Conecta primero.')); socket.emit('room:create',{},r => r?.ok ? resolve(r.room) : reject(new Error(r?.error || 'No se pudo crear la sala.'))); }); },
    joinRoom(code) { return new Promise((resolve,reject) => { if (!socket) return reject(new Error('Conecta primero.')); socket.emit('room:join',{code},r => r?.ok ? resolve(r.room) : reject(new Error(r?.error || 'No se pudo entrar.'))); }); },
    sendPlayerState(state) { socket?.volatile.emit('player:state',state); },
    leaveRoom() { socket?.emit('room:leave'); },
    get socket() { return socket; }
  };
})();
