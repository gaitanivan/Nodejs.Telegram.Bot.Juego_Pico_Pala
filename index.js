// index.js
import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import fs from 'fs';
import { generarNumeroSecreto, calcularPicosYPalas } from './juego.js';
import { 
  registrarUsuario, 
  eliminarUsuario,
  setBuscandoRivales, 
  isBuscandoRivales, 
  establecerFiltro,
  obtenerUsuario,
  toggleNoMolestar,
  bloquearUsuario,
  desbloquearUsuario,
  generarTecladoRivales,
  generarTecladoBloqueados
} from './usuariosManager.js';
import { 
  obtenerBotonesInicio, 
  obtenerTextoTablero, 
  renderizarMenuRivales,
  renderizarMenuBloqueados,
  obtenerBotonesFinPvp
} from './pantallas.js';

dotenv.config();

if (!process.env.PICO_PALA_BOT_TOKEN) {
  console.error("❌ ERROR: No se encontró la variable PICO_PALA_BOT_TOKEN en el archivo .env");
  process.exit(1);
}

const bot = new Telegraf(process.env.PICO_PALA_BOT_TOKEN, {
  telegram: {
    timeout: 60000
  }
});
const SESIONES_FILE = './sesiones.json';
const retosPendientes = {}; 

const pantallaActualFiltrado = {};

function cargarSesiones() {
  try {
    if (fs.existsSync(SESIONES_FILE)) {
      return JSON.parse(fs.readFileSync(SESIONES_FILE, 'utf8'));
    }
  } catch (err) {
    console.log("⚠️ No se pudieron cargar las sesiones previas:", err.message);
  }
  return {};
}

function guardarSesiones() {
  try {
    fs.writeFileSync(SESIONES_FILE, JSON.stringify(partidasActivas, null, 2));
  } catch (err) {
    console.log("⚠️ Error al guardar sesiones:", err.message);
  }
}

const partidasActivas = cargarSesiones();

// --- EVENTO: USUARIO BLOQUEA O DETIENE EL BOT ---
bot.on('my_chat_member', (ctx) => {
  const newStatus = ctx.myChatMember?.new_chat_member?.status;
  const userId = ctx.from.id;

  if (newStatus === 'kicked') {
    console.log(`[EVENTO] El usuario ${userId} bloqueó o detuvo el bot. Procediendo a eliminar sus datos.`);
    eliminarUsuario(userId, partidasActivas, guardarSesiones);
  }
});

async function procesarAbandonoOInicio(ctx, chatId) {
  const partida = partidasActivas[chatId];
  if (partida && partida.rivalId) {
    const rivalId = partida.rivalId;
    const partidaRival = partidasActivas[rivalId];

    if (partidaRival) {
      delete partidaRival.jugando;
      delete partidaRival.esperandoRespuestaPvp;
      delete partidaRival.quiereVolverAJugar;
      delete partidaRival.ultimoPerdedorId;
      delete partidaRival.rivalId;
      guardarSesiones();

      const usuarioActual = obtenerUsuario(chatId);
      const nombreActual = usuarioActual ? usuarioActual.first_name : "Tu rival";

      await ctx.telegram.editMessageText(
        rivalId,
        partidaRival.feedbackMessageId,
        null,
        `💬 *MENSAJES Y ESTADO*\n\nℹ️ *${nombreActual}* ha vuelto al menú inicio.\nSelecciona una opción para continuar:`,
        { parse_mode: 'Markdown', ...obtenerBotonesInicio(rivalId) }
      ).catch((err) => {
        if (err.response && err.response.error_code === 403) {
          eliminarUsuario(rivalId, partidasActivas, guardarSesiones);
        }
      });
    }
  }

  delete retosPendientes[chatId];
  for (const key in retosPendientes) {
    if (retosPendientes[key].retadorId === chatId) delete retosPendientes[key];
  }

  await inicializarPantallaInicio(ctx, chatId);
}

async function inicializarPantallaInicio(ctx, chatId) {
  setBuscandoRivales(chatId, false);
  delete pantallaActualFiltrado[chatId];

  if (partidasActivas[chatId]) {
    const partidaVieja = partidasActivas[chatId];
    try {
      if (partidaVieja.tablaMessageId) await ctx.telegram.deleteMessage(chatId, partidaVieja.tablaMessageId);
    } catch {}
    try {
      if (partidaVieja.feedbackMessageId) await ctx.telegram.deleteMessage(chatId, partidaVieja.feedbackMessageId);
    } catch {}
    delete partidasActivas[chatId];
  }

  const mensajeTabla = await ctx.telegram.sendMessage(
    chatId,
    "📊 *TABLERO DE JUEGO*\n\nEl tablero se activará cuando comience la partida.",
    { parse_mode: 'Markdown' }
  );

  const mensajeFeedback = await ctx.telegram.sendMessage(
    chatId,
    "💬 *MENSAJES Y ESTADO*\n\n¡Bienvenido a Pico y Pala! 🎮\nSelecciona una opción para empezar a jugar.",
    {
      parse_mode: 'Markdown',
      ...obtenerBotonesInicio(chatId)
    }
  );

  partidasActivas[chatId] = {
    jugando: false,
    tablaMessageId: mensajeTabla.message_id,
    feedbackMessageId: mensajeFeedback.message_id
  };

  guardarSesiones();
}

async function iniciarPartidaPvp(ctx, retadorId, rivalId) {
  const partidaA = partidasActivas[retadorId];
  const partidaB = partidasActivas[rivalId];

  if (!partidaA || !partidaB) return;

  setBuscandoRivales(retadorId, false);
  setBuscandoRivales(rivalId, false);
  delete pantallaActualFiltrado[retadorId];
  delete pantallaActualFiltrado[rivalId];

  delete partidaA.esperandoRespuestaPvp;
  delete partidaB.esperandoRespuestaPvp;
  delete partidaA.quiereVolverAJugar;
  delete partidaB.quiereVolverAJugar;

  const numeroDeA = generarNumeroSecreto();
  const numeroDeB = generarNumeroSecreto();

  let turnoParaA = true;
  let turnoParaB = false;

  if (partidaA.ultimoPerdedorId === rivalId || partidaB.ultimoPerdedorId === rivalId) {
    turnoParaA = false;
    turnoParaB = true;
  }

  delete partidaA.ultimoPerdedorId;
  delete partidaB.ultimoPerdedorId;

  partidaA.jugando = true;
  partidaA.multijugador = true;
  partidaA.rivalId = rivalId;
  partidaA.miNumeroSecreto = numeroDeA;
  partidaA.numeroSecretoRival = numeroDeB;
  partidaA.esMiTurno = turnoParaA;
  partidaA.intentos = [];

  partidaB.jugando = true;
  partidaB.multijugador = true;
  partidaB.rivalId = retadorId;
  partidaB.miNumeroSecreto = numeroDeB;
  partidaB.numeroSecretoRival = numeroDeA;
  partidaB.esMiTurno = turnoParaB;
  partidaB.intentos = [];

  guardarSesiones();
  delete retosPendientes[rivalId];
  delete retosPendientes[retadorId];

  const usuarioA = obtenerUsuario(retadorId);
  const usuarioB = obtenerUsuario(rivalId);
  const nombreA = usuarioA ? usuarioA.first_name : "Jugador A";
  const nombreB = usuarioB ? usuarioB.first_name : "Jugador B";

  await ctx.telegram.editMessageText(retadorId, partidaA.tablaMessageId, null, obtenerTextoTablero(nombreB, numeroDeA, [], true), { parse_mode: 'Markdown' }).catch((err) => {
    if (err.response && err.response.error_code === 403) eliminarUsuario(retadorId, partidasActivas, guardarSesiones);
  });
  await ctx.telegram.editMessageText(rivalId, partidaB.tablaMessageId, null, obtenerTextoTablero(nombreA, numeroDeB, [], true), { parse_mode: 'Markdown' }).catch((err) => {
    if (err.response && err.response.error_code === 403) eliminarUsuario(rivalId, partidasActivas, guardarSesiones);
  });

  const primerJugadorId = turnoParaA ? retadorId : rivalId;
  const segundoJugadorId = turnoParaA ? rivalId : retadorId;

  const nombrePrimerJugador = turnoParaA ? nombreA : nombreB;
  const nombreSegundoJugador = turnoParaA ? nombreB : nombreA;

  await ctx.telegram.editMessageText(
    primerJugadorId,
    partidasActivas[primerJugadorId].feedbackMessageId,
    null,
    `💬 *MENSAJES Y ESTADO*\n\n🟢 *¡Es tu turno!* (Tiras primero). Escribe un número de 3 dígitos sin repetir para adivinar el de ${nombreSegundoJugador}.`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Rendirse', 'cancelar_partida_pvp')]]) }
  ).catch((err) => {
    if (err.response && err.response.error_code === 403) eliminarUsuario(primerJugadorId, partidasActivas, guardarSesiones);
  });

  await ctx.telegram.editMessageText(
    segundoJugadorId,
    partidasActivas[segundoJugadorId].feedbackMessageId,
    null,
    `💬 *MENSAJES Y ESTADO*\n\n⏳ Turno de *${nombrePrimerJugador}*. Esperando su movimiento...`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Rendirse', 'cancelar_partida_pvp')]]) }
  ).catch((err) => {
    if (err.response && err.response.error_code === 403) eliminarUsuario(segundoJugadorId, partidasActivas, guardarSesiones);
  });
}

// --- COMANDOS Y INICIO ---
bot.command('start', async (ctx) => {
  try { await ctx.deleteMessage(ctx.message.message_id); } catch {}
  registrarUsuario(ctx);
  await procesarAbandonoOInicio(ctx, ctx.chat.id);
});

bot.action('reiniciar_todo', async (ctx) => {
  await ctx.answerCbQuery("Reiniciando...").catch(() => {});
  registrarUsuario(ctx);
  await procesarAbandonoOInicio(ctx, ctx.chat.id);
});

bot.action('toggle_dnd', async (ctx) => {
  const chatId = ctx.chat.id;
  toggleNoMolestar(chatId);
  await ctx.answerCbQuery().catch(() => {});

  const partida = partidasActivas[chatId];
  if (partida) {
    await ctx.telegram.editMessageText(
      chatId,
      partida.feedbackMessageId,
      null,
      "💬 *MENSAJES Y ESTADO*\n\n¡Bienvenido a Pico y Pala! 🎮\nSelecciona una opción para empezar a jugar.",
      { parse_mode: 'Markdown', ...obtenerBotonesInicio(chatId) }
    ).catch(err => console.log(err.message));
  }
});

// --- MENÚS DE SELECCIÓN ---
bot.action('abrir_menu_rivales', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});
  setBuscandoRivales(chatId, true);
  pantallaActualFiltrado[chatId] = 'rivales';
  await renderizarMenuRivales(ctx, chatId, partidasActivas, 0);
});

bot.action(/^pag_rivales:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await renderizarMenuRivales(ctx, ctx.chat.id, partidasActivas, parseInt(ctx.match[1]));
});

bot.action('limpiar_filtro_busqueda', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});
  establecerFiltro(chatId, "");
  await renderizarMenuRivales(ctx, chatId, partidasActivas, 0);
});

bot.action('cancelar_busqueda', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});
  setBuscandoRivales(chatId, false);
  delete pantallaActualFiltrado[chatId];

  const partida = partidasActivas[chatId];
  if (!partida) return;

  await ctx.telegram.editMessageText(
    chatId,
    partida.feedbackMessageId,
    null,
    "💬 *MENSAJES Y ESTADO*\n\n¡Bienvenido a Pico y Pala! 🎮\nSelecciona una opción para empezar a jugar.",
    { parse_mode: 'Markdown', ...obtenerBotonesInicio(chatId) }
  ).catch(err => console.log(err.message));
});

bot.action('abrir_menu_bloqueados', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});
  setBuscandoRivales(chatId, true);
  pantallaActualFiltrado[chatId] = 'bloqueados';
  await renderizarMenuBloqueados(ctx, chatId, partidasActivas, 0);
});

bot.action(/^pag_bloqueados:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await renderizarMenuBloqueados(ctx, ctx.chat.id, partidasActivas, parseInt(ctx.match[1]));
});

bot.action('limpiar_filtro_bloqueados', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});
  establecerFiltro(chatId, "");
  await renderizarMenuBloqueados(ctx, chatId, partidasActivas, 0);
});

bot.action(/^desbloquear_usuario:(\d+)$/, async (ctx) => {
  const chatId = ctx.chat.id;
  const idADesbloquear = parseInt(ctx.match[1]);
  desbloquearUsuario(chatId, idADesbloquear);
  await ctx.answerCbQuery().catch(() => {});
  await renderizarMenuBloqueados(ctx, chatId, partidasActivas, 0);
});

// --- ENVIAR Y GESTIONAR RETOS ---
bot.action(/^retar_usuario:(\d+)$/, async (ctx) => {
  const rivalId = parseInt(ctx.match[1]);
  const rival = obtenerUsuario(rivalId);
  const chatId = ctx.chat.id;
  const retador = obtenerUsuario(chatId);
  
  if (!rival || rival.noMolestar === true || (rival.bloqueados && rival.bloqueados.includes(chatId))) {
    await ctx.answerCbQuery("⚠️ Este usuario no está disponible.").catch(() => {});
    await renderizarMenuRivales(ctx, chatId, partidasActivas, 0);
    return;
  }

  if (retosPendientes[rivalId]) {
    await ctx.answerCbQuery("⚠️ Ya tiene un reto pendiente.").catch(() => {});
    return;
  }

  await ctx.answerCbQuery().catch(() => {});
  const partida = partidasActivas[chatId];
  if (!partida) return;

  await ctx.telegram.editMessageText(
    chatId,
    partida.feedbackMessageId,
    null,
    `💬 *MENSAJES Y ESTADO*\n\n✉️ Solicitud enviada a *${rival.first_name}*.\n⏳ Esperando respuesta...`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar Reto', `cancelar_reto_enviado:${rivalId}`)]])
    }
  ).catch(err => console.log(err));

  const etiquetaRetador = retador.username ? `${retador.first_name} (@${retador.username})` : retador.first_name;
  const partidaRival = partidasActivas[rivalId];
  
  if (partidaRival && partidaRival.feedbackMessageId) {
    await ctx.telegram.editMessageText(
      rivalId,
      partidaRival.feedbackMessageId,
      null,
      `🎮 *¡RETO ENTRANTE!*\n\n*${etiquetaRetador}* te ha desafiado a una partida.\n¿Aceptas el duelo?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🟢 Aceptar', `aceptar_reto:${chatId}`),
            Markup.button.callback('🔴 Rechazar', `rechazar_reto:${chatId}`)
          ],
          [Markup.button.callback('🚫 Bloquear Jugador', `bloquear_desde_reto:${chatId}`)]
        ])
      }
    ).catch(err => {
      if (err.response && err.response.error_code === 403) {
        eliminarUsuario(rivalId, partidasActivas, guardarSesiones);
      } else {
        console.log(err.message);
      }
    });

    retosPendientes[rivalId] = {
      retadorId: chatId,
      mensajeRetadorId: partida.feedbackMessageId,
      mensajeRivalId: partidaRival.feedbackMessageId
    };
  }
});

bot.action(/^cancelar_reto_enviado:(\d+)$/, async (ctx) => {
  const rivalId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});

  const reto = retosPendientes[rivalId];
  if (reto && reto.retadorId === chatId) {
    await ctx.telegram.editMessageText(
      rivalId,
      reto.mensajeRivalId,
      null,
      `💬 *MENSAJES Y ESTADO*\n\n🚫 El reto pendiente fue cancelado por el otro jugador.`,
      { parse_mode: 'Markdown', ...obtenerBotonesInicio(rivalId) }
    ).catch((err) => {
      if (err.response && err.response.error_code === 403) eliminarUsuario(rivalId, partidasActivas, guardarSesiones);
    });

    delete retosPendientes[rivalId];
  }

  setBuscandoRivales(chatId, true);
  pantallaActualFiltrado[chatId] = 'rivales';
  await renderizarMenuRivales(ctx, chatId, partidasActivas, 0);
});

bot.action(/^rechazar_reto:(\d+)$/, async (ctx) => {
  const retadorId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});

  const reto = retosPendientes[chatId];
  if (reto && reto.retadorId === retadorId) {
    await ctx.telegram.editMessageText(
      chatId, 
      reto.mensajeRivalId, 
      null, 
      `💬 *MENSAJES Y ESTADO*\n\n🔴 Rechazaste el reto.\nSelecciona una opción:`, 
      { parse_mode: 'Markdown', ...obtenerBotonesInicio(chatId) }
    ).catch(() => {});

    const partidaRetador = partidasActivas[retadorId];
    if (partidaRetador) {
      await ctx.telegram.editMessageText(
        retadorId,
        partidaRetador.feedbackMessageId,
        null,
        `💬 *MENSAJES Y ESTADO*\n\n❌ El jugador rechazó tu invitación.\n\n¿Quieres buscar a otro rival?`,
        { parse_mode: 'Markdown', ...generarTecladoRivales(retadorId, partidasActivas, 0).teclado }
      ).catch(err => {
        if (err.response && err.response.error_code === 403) {
          eliminarUsuario(retadorId, partidasActivas, guardarSesiones);
        } else {
          console.log(err);
        }
      });
    }

    delete retosPendientes[chatId];
  }
});

bot.action(/^bloquear_desde_reto:(\d+)$/, async (ctx) => {
  const retadorId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});

  bloquearUsuario(chatId, retadorId);

  const reto = retosPendientes[chatId];
  if (reto && reto.retadorId === retadorId) {
    await ctx.telegram.editMessageText(
      chatId, 
      reto.mensajeRivalId, 
      null, 
      `💬 *MENSAJES Y ESTADO*\n\n🚫 Jugador bloqueado con éxito.\nSelecciona una opción para continuar:`, 
      { parse_mode: 'Markdown', ...obtenerBotonesInicio(chatId) }
    ).catch(() => {});

    const partidaRetador = partidasActivas[retadorId];
    if (partidaRetador) {
      await ctx.telegram.editMessageText(
        retadorId,
        partidaRetador.feedbackMessageId,
        null,
        `💬 *MENSAJES Y ESTADO*\n\n❌ El reto no se pudo concretar porque el usuario ya no está disponible.`,
        { parse_mode: 'Markdown', ...generarTecladoRivales(retadorId, partidasActivas, 0).teclado }
      ).catch(err => {
        if (err.response && err.response.error_code === 403) {
          eliminarUsuario(retadorId, partidasActivas, guardarSesiones);
        } else {
          console.log(err);
        }
      });
    }

    delete retosPendientes[chatId];
  }
});

// --- LÓGICA MULTIJUGADOR ---
bot.action(/^aceptar_reto:(\d+)$/, async (ctx) => {
  const retadorId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});
  await iniciarPartidaPvp(ctx, retadorId, chatId);
});

// --- ACCIONES POST-PARTIDA PVP Y VUELTA AL INICIO ---
bot.action('volver_inicio', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});
  await procesarAbandonoOInicio(ctx, chatId);
});

bot.action(/^solicitar_jugar_nuevamente:(\d+)$/, async (ctx) => {
  const rivalId = parseInt(ctx.match[1]);
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});

  const partida = partidasActivas[chatId];
  const partidaRival = partidasActivas[rivalId];
  const rival = obtenerUsuario(rivalId);

  if (!partida || !partidaRival) return;

  partida.quiereVolverAJugar = true;
  guardarSesiones();

  if (partidaRival.quiereVolverAJugar) {
    await iniciarPartidaPvp(ctx, chatId, rivalId);
    return;
  }

  await ctx.telegram.editMessageText(
    chatId,
    partida.feedbackMessageId,
    null,
    `💬 *MENSAJES Y ESTADO*\n\n✉️ Indicaste que quieres volver a jugar con *${rival ? rival.first_name : 'tu rival'}*.\n⏳ Esperando a que el otro jugador seleccione su opción...`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🏠 Volver al Inicio', 'volver_inicio')]])
    }
  ).catch(err => console.log(err));
});

// --- SINGLEPLAYER & RENDICIONES ---
bot.action('retar_bot', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});

  const partida = partidasActivas[chatId];
  if (!partida) return;

  const numeroSecreto = generarNumeroSecreto();
  partida.jugando = true;
  partida.multijugador = false;
  partida.numeroSecreto = numeroSecreto;
  partida.numeroSecretoRival = numeroSecreto;
  partida.intentos = [];
  guardarSesiones();

  await ctx.telegram.editMessageText(chatId, partida.tablaMessageId, null, obtenerTextoTablero(null, null, [], false), { parse_mode: 'Markdown' }).catch(() => {});
  await ctx.telegram.editMessageText(
    chatId,
    partida.feedbackMessageId,
    null,
    "💬 *MENSAJES Y ESTADO*\n\n🤖 He pensado un número de 3 dígitos sin repetir.\nEscribe tu primer intento para empezar.",
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar / Rendirse', 'cancelar_partida')]]) }
  ).catch(() => {});
});

bot.action('cancelar_partida', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});

  const partida = partidasActivas[chatId];
  if (partida && partida.jugando && !partida.multijugador) {
    const numeroSecreto = partida.numeroSecretoRival || partida.numeroSecreto;
    partida.jugando = false;
    delete partida.numeroSecreto;
    delete partida.numeroSecretoRival;
    delete partida.intentos;
    guardarSesiones();

    await ctx.telegram.editMessageText(
      chatId,
      partida.feedbackMessageId,
      null,
      `💬 *MENSAJES Y ESTADO*\n\n❌ Te has rendido. El número secreto era: *${numeroSecreto}*.\n\n¿Quieres volver a jugar?`,
      { parse_mode: 'Markdown', ...obtenerBotonesInicio(chatId) }
    ).catch(() => {});
  }
});

bot.action('cancelar_partida_pvp', async (ctx) => {
  const chatId = ctx.chat.id;
  await ctx.answerCbQuery().catch(() => {});

  const partida = partidasActivas[chatId];
  if (partida && partida.jugando && partida.multijugador) {
    const rivalId = partida.rivalId;
    const partidaRival = partidasActivas[rivalId];

    partida.jugando = false;
    partida.ultimoPerdedorId = chatId;
    if (partidaRival) partidaRival.ultimoPerdedorId = chatId;
    
    guardarSesiones();

    await ctx.telegram.editMessageText(
      chatId,
      partida.feedbackMessageId,
      null,
      `❌ *Te has rendido.*\n\nEl número de tu rival era: *${partida.numeroSecretoRival}*.`,
      { parse_mode: 'Markdown', ...obtenerBotonesInicio(chatId) }
    ).catch(() => {});

    if (partidaRival && partidaRival.jugando) {
      partidaRival.jugando = false;
      guardarSesiones();

      const usuarioActual = obtenerUsuario(chatId);
      const nombreActual = usuarioActual ? usuarioActual.first_name : "Tu rival";

      await ctx.telegram.editMessageText(
        rivalId,
        partidaRival.feedbackMessageId,
        null,
        `🏆 *¡GANASTE POR ABANDONO!* 🏆\n\n*${nombreActual}* se ha rendido.\nSu número secreto era: *${partidaRival.numeroSecretoRival}*.`,
        { parse_mode: 'Markdown', ...obtenerBotonesInicio(rivalId) }
      ).catch((err) => {
        if (err.response && err.response.error_code === 403) eliminarUsuario(rivalId, partidasActivas, guardarSesiones);
      });
    }
  }
});

// --- TEXTO (FILTROS Y TURNOS) ---
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const texto = ctx.message.text.trim();

  try { await ctx.deleteMessage(ctx.message.message_id); } catch {}
  const partida = partidasActivas[chatId];

  if (isBuscandoRivales(chatId)) {
    establecerFiltro(chatId, texto);
    if (pantallaActualFiltrado[chatId] === 'bloqueados') {
      await renderizarMenuBloqueados(ctx, chatId, partidasActivas, 0);
    } else {
      await renderizarMenuRivales(ctx, chatId, partidasActivas, 0);
    }
    return;
  }

  if (partida && partida.jugando) {
    if (partida.multijugador && !partida.esMiTurno) {
      const usuarioRival = obtenerUsuario(partida.rivalId);
      await ctx.telegram.editMessageText(
        chatId,
        partida.feedbackMessageId,
        null,
        `💬 *MENSAJES Y ESTADO*\n\n⚠️ *No es tu turno.* Espera a *${usuarioRival ? usuarioRival.first_name : 'tu rival'}.*`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Rendirse', 'cancelar_partida_pvp')]]) }
      ).catch(() => {});
      return;
    }

    const regexTresDigitos = /^\d{3}$/;
    if (!regexTresDigitos.test(texto)) {
      await ctx.telegram.editMessageText(
        chatId,
        partida.feedbackMessageId,
        null,
        "💬 *MENSAJES Y ESTADO*\n\n⚠️ ¡Error! Debes ingresar exactamente un número de 3 dígitos sin repetir.",
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Rendirse', partida.multijugador ? 'cancelar_partida_pvp' : 'cancelar_partida')]]) }
      ).catch(() => {});
      return;
    }

    const resultado = calcularPicosYPalas(partida.numeroSecretoRival, texto);
    partida.intentos.push({ numero: texto, picos: resultado.picos, palas: resultado.palas });
    guardarSesiones();

    const rivalId = partida.rivalId;
    const partidaRival = partidasActivas[rivalId];

    if (partida.multijugador && partidaRival) {
      const usuarioRival = obtenerUsuario(rivalId);
      const usuarioActual = obtenerUsuario(chatId);
      const nombreRival = usuarioRival ? usuarioRival.first_name : "Rival";
      const nombreActual = usuarioActual ? usuarioActual.first_name : "Tú";

      await ctx.telegram.editMessageText(chatId, partida.tablaMessageId, null, obtenerTextoTablero(nombreRival, partida.miNumeroSecreto, partida.intentos, true), { parse_mode: 'Markdown' }).catch(() => {});

      if (resultado.picos === 3) {
        const intentosTotales = partida.intentos.length;
        partida.jugando = false;
        partidaRival.jugando = false;

        partida.esperandoRespuestaPvp = true;
        partidaRival.esperandoRespuestaPvp = true;
        
        delete partida.quiereVolverAJugar;
        delete partidaRival.quiereVolverAJugar;

        partida.ultimoPerdedorId = rivalId;
        partidaRival.ultimoPerdedorId = rivalId;
        
        guardarSesiones();

        await ctx.telegram.editMessageText(
          chatId, 
          partida.feedbackMessageId, 
          null, 
          `🏆 *¡SÍ, GANASTE!* 🏆\n\nAdivinaste el número de *${nombreRival}* (*${partida.numeroSecretoRival}*) en *${intentosTotales}* intentos.`, 
          { parse_mode: 'Markdown', ...obtenerBotonesFinPvp(rivalId, nombreRival) }
        ).catch(() => {});

        await ctx.telegram.editMessageText(
          rivalId, 
          partidaRival.feedbackMessageId, 
          null, 
          `💔 *FIN DE LA PARTIDA*\n\n*${nombreActual}* adivinó tu número (*${partidaRival.miNumeroSecreto}*) en *${intentosTotales}* intentos.`, 
          { parse_mode: 'Markdown', ...obtenerBotonesFinPvp(chatId, nombreActual) }
        ).catch((err) => {
          if (err.response && err.response.error_code === 403) eliminarUsuario(rivalId, partidasActivas, guardarSesiones);
        });

        return;
      }

      partida.esMiTurno = false;
      partidaRival.esMiTurno = true;
      guardarSesiones();

      await ctx.telegram.editMessageText(chatId, partida.feedbackMessageId, null, `💬 *MENSAJES Y ESTADO*\n\nProcesado intento: *${texto}* (Picos: ${resultado.picos}, Palas: ${resultado.palas}).\n\n⏳ Turno de *${nombreRival}*...`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Rendirse', 'cancelar_partida_pvp')]]) }).catch(() => {});
      await ctx.telegram.editMessageText(rivalId, partidaRival.feedbackMessageId, null, `💬 *MENSAJES Y ESTADO*\n\n📢 *${nombreActual}* jugó: *${texto}* (Picos: ${resultado.picos}, Palas: ${resultado.palas}).\n\n🟢 *¡Es tu turno!*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Rendirse', 'cancelar_partida_pvp')]]) }).catch((err) => {
        if (err.response && err.response.error_code === 403) eliminarUsuario(rivalId, partidasActivas, guardarSesiones);
      });

    } else {
      await ctx.telegram.editMessageText(chatId, partida.tablaMessageId, null, obtenerTextoTablero(null, null, partida.intentos, false), { parse_mode: 'Markdown' }).catch(() => {});

      if (resultado.picos === 3) {
        const intentosTotales = partida.intentos.length;
        const numGanador = partida.numeroSecretoRival || partida.numeroSecreto;
        partida.jugando = false;
        delete partida.numeroSecreto; delete partida.numeroSecretoRival; delete partida.intentos;
        guardarSesiones();

        await ctx.telegram.editMessageText(chatId, partida.feedbackMessageId, null, `🏆 *¡GANASTE!* 🏆\n\n¡Adivinaste el número *${numGanador}* en *${intentosTotales}* intentos!`, { parse_mode: 'Markdown', ...obtenerBotonesInicio(chatId) }).catch(() => {});
        return;
      }

      await ctx.telegram.editMessageText(chatId, partida.feedbackMessageId, null, `💬 *MENSAJES Y ESTADO*\n\nProcesado intento: *${texto}* (Picos: ${resultado.picos}, Palas: ${resultado.palas}).`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancelar / Rendirse', 'cancelar_partida')]]) }).catch(() => {});
    }
  }
});

bot.launch().then(() => console.log("🚀 Bot listo...")).catch(err => console.error(err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));