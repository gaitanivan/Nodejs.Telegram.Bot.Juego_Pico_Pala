// usuariosManager.js
import { Markup } from 'telegraf';

const registroUsuarios = {};

function limpiarAcentos(texto) {
  if (!texto) return "";
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function registrarUsuario(ctx) {
  const from = ctx.from;
  if (!from) return;

  const chatId = ctx.chat.id.toString();
  
  if (!registroUsuarios[chatId]) {
    registroUsuarios[chatId] = {
      id: ctx.chat.id,
      username: from.username || "",
      first_name: from.first_name || "Jugador Anónimo",
      buscandoRivales: false,
      filtroBusqueda: "",
      noMolestar: false,
      bloqueados: []
    };
    console.log(`[USER] Registrado nuevo: ${from.first_name} [ID: ${chatId}]`);
  } else {
    registroUsuarios[chatId].username = from.username || "";
    registroUsuarios[chatId].first_name = from.first_name || "Jugador Anónimo";
  }
}

export function eliminarUsuario(chatId, partidasActivas = {}, guardarSesiones = null) {
  const idStr = chatId.toString();
  const idNum = parseInt(chatId);

  if (registroUsuarios[idStr]) {
    delete registroUsuarios[idStr];
    console.log(`[USER] Usuario eliminado de registros: ${idStr}`);

    // Limpiar de la lista de bloqueados de otros usuarios
    Object.values(registroUsuarios).forEach(usuario => {
      if (usuario.bloqueados) {
        usuario.bloqueados = usuario.bloqueados.filter(bId => bId !== idNum);
      }
    });
  }

  // Si el usuario tenía partida o sesión activa, la eliminamos
  if (partidasActivas && partidasActivas[idStr]) {
    delete partidasActivas[idStr];
    if (typeof guardarSesiones === 'function') {
      guardarSesiones();
    }
  }
}

function obtenerUsuariosElegibles(solicitanteId, partidasActivas) {
  const solicitante = registroUsuarios[solicitanteId.toString()];
  const filtro = solicitante && solicitante.filtroBusqueda ? limpiarAcentos(solicitante.filtroBusqueda) : "";

  return Object.values(registroUsuarios).filter(usuario => {
    const usuarioIdStr = usuario.id.toString();

    if (usuarioIdStr === solicitanteId.toString()) return false;

    if (usuario.noMolestar === true) return false;

    // Si el usuario está jugando o decidiendo si volver a jugar, no aparece en búsquedas
    const partidaRival = partidasActivas[usuarioIdStr];
    if (partidaRival && (partidaRival.jugando || partidaRival.esperandoRespuestaPvp)) return false;

    if (usuario.bloqueados && usuario.bloqueados.includes(parseInt(solicitanteId))) return false;
    if (solicitante && solicitante.bloqueados && solicitante.bloqueados.includes(usuario.id)) return false;

    if (filtro) {
      const nombreNormalizado = limpiarAcentos(usuario.first_name);
      const aliasNormalizado = limpiarAcentos(usuario.username);
      return nombreNormalizado.includes(filtro) || aliasNormalizado.includes(filtro);
    }

    return true;
  });
}

export function generarTecladoRivales(solicitanteId, partidasActivas, pagina = 0) {
  const solicitante = registroUsuarios[solicitanteId.toString()];
  const elegibles = obtenerUsuariosElegibles(solicitanteId, partidasActivas);

  const limitePorPagina = 10;
  const totalPaginas = Math.ceil(elegibles.length / limitePorPagina);
  
  let paginaValida = pagina;
  if (paginaValida >= totalPaginas && totalPaginas > 0) {
    paginaValida = totalPaginas - 1;
  }

  const inicio = paginaValida * limitePorPagina;
  const fin = inicio + limitePorPagina;
  const usuariosPagina = elegibles.slice(inicio, fin);

  const totalElegibles = elegibles.length;
  const deRival = totalElegibles > 0 ? inicio + 1 : 0;
  const aRival = Math.min(fin, totalElegibles);
  const textoMostrando = `Mostrando ${deRival}-${aRival} de ${totalElegibles} rivales`;

  const filasTeclado = [];

  for (let i = 0; i < usuariosPagina.length; i += 2) {
    const fila = [];
    
    const u1 = usuariosPagina[i];
    const etiqueta1 = u1.username ? `${u1.first_name} (@${u1.username})` : u1.first_name;
    fila.push(Markup.button.callback(etiqueta1, `retar_usuario:${u1.id}`));

    if (usuariosPagina[i + 1]) {
      const u2 = usuariosPagina[i + 1];
      const etiqueta2 = u2.username ? `${u2.first_name} (@${u2.username})` : u2.first_name;
      fila.push(Markup.button.callback(etiqueta2, `retar_usuario:${u2.id}`));
    }

    filasTeclado.push(fila);
  }

  const filaNavegacion = [];
  if (paginaValida > 0) {
    filaNavegacion.push(Markup.button.callback('⬅️ Atrás', `pag_rivales:${paginaValida - 1}`));
  }
  if (fin < totalElegibles) {
    filaNavegacion.push(Markup.button.callback('➡️ Siguiente', `pag_rivales:${paginaValida + 1}`));
  }
  if (filaNavegacion.length > 0) {
    filasTeclado.push(filaNavegacion);
  }

  const filaAccion = [
    Markup.button.callback('❌ Cancelar', 'cancelar_busqueda')
  ];
  if (solicitante && solicitante.filtroBusqueda) {
    filaAccion.unshift(Markup.button.callback('🧹 Limpiar Filtro', 'limpiar_filtro_busqueda'));
  }
  filasTeclado.push(filaAccion);

  return {
    teclado: Markup.inlineKeyboard(filasTeclado),
    totalUsuarios: totalElegibles,
    textoMostrando: textoMostrando,
    paginaActual: paginaValida,
    totalPaginas: totalPaginas || 1,
    filtroActual: solicitante ? solicitante.filtroBusqueda : ""
  };
}

export function setBuscandoRivales(chatId, estado) {
  if (registroUsuarios[chatId.toString()]) {
    registroUsuarios[chatId.toString()].buscandoRivales = estado;
    if (!estado) {
      registroUsuarios[chatId.toString()].filtroBusqueda = "";
    }
  }
}

export function isBuscandoRivales(chatId) {
  return registroUsuarios[chatId.toString()] ? registroUsuarios[chatId.toString()].buscandoRivales : false;
}

export function establecerFiltro(chatId, texto) {
  if (registroUsuarios[chatId.toString()]) {
    registroUsuarios[chatId.toString()].filtroBusqueda = texto;
  }
}

export function obtenerUsuario(chatId) {
  return registroUsuarios[chatId.toString()];
}

export function toggleNoMolestar(chatId) {
  const usuario = registroUsuarios[chatId.toString()];
  if (usuario) {
    usuario.noMolestar = !usuario.noMolestar;
    return usuario.noMolestar;
  }
  return false;
}

export function bloquearUsuario(chatId, idABloquear) {
  const usuario = registroUsuarios[chatId.toString()];
  if (usuario) {
    if (!usuario.bloqueados.includes(idABloquear)) {
      usuario.bloqueados.push(idABloquear);
      console.log(`[PRIVACIDAD] Usuario ${chatId} bloqueó a ${idABloquear}`);
    }
  }
}

export function desbloquearUsuario(chatId, idADesbloquear) {
  const usuario = registroUsuarios[chatId.toString()];
  if (usuario && usuario.bloqueados) {
    usuario.bloqueados = usuario.bloqueados.filter(id => id !== parseInt(idADesbloquear));
    console.log(`[PRIVACIDAD] Usuario ${chatId} desbloqueó a ${idADesbloquear}`);
  }
}

export function generarTecladoBloqueados(solicitanteId, pagina = 0) {
  const solicitante = registroUsuarios[solicitanteId.toString()];
  
  if (!solicitante || !solicitante.bloqueados || solicitante.bloqueados.length === 0) {
    return {
      teclado: Markup.inlineKeyboard([[Markup.button.callback('❌ Volver al Inicio', 'cancelar_busqueda')]]),
      totalUsuarios: 0,
      textoMostrando: "Mostrando 0-0 de 0 usuarios bloqueados",
      paginaActual: 0,
      totalPaginas: 1,
      filtroActual: solicitante ? solicitante.filtroBusqueda : ""
    };
  }

  const filtro = solicitante.filtroBusqueda ? limpiarAcentos(solicitante.filtroBusqueda) : "";

  const bloqueadosElegibles = solicitante.bloqueados.map(id => registroUsuarios[id.toString()]).filter(usuario => {
    if (!usuario) return false;
    if (filtro) {
      const nombreNormalizado = limpiarAcentos(usuario.first_name);
      const aliasNormalizado = limpiarAcentos(usuario.username);
      return nombreNormalizado.includes(filtro) || aliasNormalizado.includes(filtro);
    }
    return true;
  });

  const limitePorPagina = 10;
  const totalPaginas = Math.ceil(bloqueadosElegibles.length / limitePorPagina);
  
  let paginaValida = pagina;
  if (paginaValida >= totalPaginas && totalPaginas > 0) {
    paginaValida = totalPaginas - 1;
  }

  const inicio = paginaValida * limitePorPagina;
  const fin = inicio + limitePorPagina;
  const usuariosPagina = bloqueadosElegibles.slice(inicio, fin);

  const totalElegibles = bloqueadosElegibles.length;
  const deUsuario = totalElegibles > 0 ? inicio + 1 : 0;
  const aUsuario = Math.min(fin, totalElegibles);
  const textoMostrando = `Mostrando ${deUsuario}-${aUsuario} de ${totalElegibles} bloqueados`;

  const filasTeclado = [];

  for (let i = 0; i < usuariosPagina.length; i += 2) {
    const fila = [];
    
    const u1 = usuariosPagina[i];
    const etiqueta1 = u1.username ? `🔓 ${u1.first_name} (@${u1.username})` : `🔓 ${u1.first_name}`;
    fila.push(Markup.button.callback(etiqueta1, `desbloquear_usuario:${u1.id}`));

    if (usuariosPagina[i + 1]) {
      const u2 = usuariosPagina[i + 1];
      const etiqueta2 = u2.username ? `🔓 ${u2.first_name} (@${u2.username})` : `🔓 ${u2.first_name}`;
      fila.push(Markup.button.callback(etiqueta2, `desbloquear_usuario:${u2.id}`));
    }

    filasTeclado.push(fila);
  }

  const filaNavegacion = [];
  if (paginaValida > 0) {
    filaNavegacion.push(Markup.button.callback('⬅️ Atrás', `pag_bloqueados:${paginaValida - 1}`));
  }
  if (fin < totalElegibles) {
    filaNavegacion.push(Markup.button.callback('➡️ Siguiente', `pag_bloqueados:${paginaValida + 1}`));
  }
  if (filaNavegacion.length > 0) {
    filasTeclado.push(filaNavegacion);
  }

  const filaAccion = [
    Markup.button.callback('❌ Volver al Inicio', 'cancelar_busqueda')
  ];
  if (solicitante && solicitante.filtroBusqueda) {
    filaAccion.unshift(Markup.button.callback('🧹 Limpiar Filtro', 'limpiar_filtro_bloqueados'));
  }
  filasTeclado.push(filaAccion);

  return {
    teclado: Markup.inlineKeyboard(filasTeclado),
    totalUsuarios: totalElegibles,
    textoMostrando: textoMostrando,
    paginaActual: paginaValida,
    totalPaginas: totalPaginas || 1,
    filtroActual: solicitante ? solicitante.filtroBusqueda : ""
  };
}