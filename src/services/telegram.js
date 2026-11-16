const TELEGRAM_API_BASE = 'https://api.telegram.org';

export function escapeTelegramHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function translateTelegramError(status, description = '') {
  const desc = String(description);
  if (status === 401 || /unauthorized/i.test(desc)) {
    return 'Token do Bot inválido ou revogado. Confira o token gerado no @BotFather.';
  }
  if (/chat not found/i.test(desc)) {
    return 'Grupo/Chat ID não encontrado. Verifique se o ID está correto (ex: -100...) e se o bot foi adicionado ao grupo.';
  }
  if (status === 403 || /bot was kicked|not a member|have no rights|can't send/i.test(desc)) {
    return 'O bot não tem permissão para enviar mensagens neste grupo/canal. Adicione-o como membro ou administrador.';
  }
  if (/upgraded to a supergroup/i.test(desc)) {
    return `O grupo foi convertido em supergrupo. Use o novo ID informado pelo Telegram (${desc}).`;
  }
  if (status === 429) {
    return 'Limite temporário de envios do Telegram atingido. Aguarde alguns segundos e tente novamente.';
  }
  return desc || `Erro HTTP ${status} na API do Telegram.`;
}

async function callTelegramApi(botToken, method, payload = null, fetchImpl = fetch) {
  const token = String(botToken || '').trim();
  if (!token) {
    throw new Error('Token do bot Telegram não configurado.');
  }
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
  const init = payload
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000)
      }
    : {
        method: 'GET',
        signal: AbortSignal.timeout(12000)
      };

  const res = await fetchImpl(url, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Resposta inválida da API do Telegram (HTTP ${res.status}).`);
  }

  if (!res.ok || !data?.ok) {
    throw new Error(translateTelegramError(res.status, data?.description));
  }
  return data.result;
}

export async function verifyBot(botToken, fetchImpl = fetch) {
  const me = await callTelegramApi(botToken, 'getMe', null, fetchImpl);
  return {
    id: me.id,
    username: me.username,
    firstName: me.first_name
  };
}

/**
 * Inspects recent updates so the user can pick a group ID in one click
 * after adding the bot to their Telegram group.
 */
export async function detectRecentChats(botToken, fetchImpl = fetch) {
  const updates = await callTelegramApi(botToken, 'getUpdates?limit=50', null, fetchImpl);
  const chatsMap = new Map();

  for (const upd of Array.isArray(updates) ? updates : []) {
    const candidates = [
      upd.message?.chat,
      upd.edited_message?.chat,
      upd.channel_post?.chat,
      upd.edited_channel_post?.chat,
      upd.my_chat_member?.chat,
      upd.chat_member?.chat
    ].filter(Boolean);

    for (const chat of candidates) {
      const id = String(chat.id);
      if (!chatsMap.has(id)) {
        chatsMap.set(id, {
          id,
          type: chat.type,
          title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || id,
          username: chat.username || null
        });
      }
    }
  }

  // Sort groups/supergroups/channels first
  return [...chatsMap.values()].sort((a, b) => {
    const rank = (t) => (t === 'supergroup' ? 0 : t === 'group' ? 1 : t === 'channel' ? 2 : 3);
    return rank(a.type) - rank(b.type);
  });
}

function formatBrTime(isoStr) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(isoStr));
  } catch {
    return '';
  }
}

export function formatArticleMessage(article, options = {}) {
  const {
    includeSummary = true,
    includeTvSuggestion = true,
    includeScore = false,
    includeLayaImportance = true,
    includeLink = true
  } = options;

  const lines = [];
  const timeStr = formatBrTime(article.publishedAt);
  const cat = escapeTelegramHtml(article.tvCategory || 'Natal/RN');
  const src = escapeTelegramHtml(article.sourceName || 'Portal Local');

  lines.push('📺 <b>SUGESTÃO DE PAUTA — NATAL/RN</b>');
  lines.push(`<b>[${cat}]</b> • <i>${src}${timeStr ? ` (${timeStr})` : ''}</i>`);
  lines.push('');
  lines.push(`<b>${escapeTelegramHtml(article.title)}</b>`);

  if (includeSummary && article.summary) {
    lines.push('');
    lines.push(escapeTelegramHtml(article.summary));
  }

  if (includeLayaImportance && article.laya && article.laya.source === 'laya') {
    const impLabel = escapeTelegramHtml(article.laya.importanceLabel || 'Média');
    const impScore = Math.round(article.laya.importanceScore ?? 0);
    const interestTag = article.laya.isInteresting ? 'Sim' : 'Baixo';
    const interestPct = Math.round((article.laya.interestingProb ?? 0) * 100);
    lines.push('');
    lines.push(
      `🧠 <b>Laya:</b> Importância <b>${impLabel}</b> (${impScore}/100) • Interessante: <b>${interestTag}</b> (${interestPct}%)`
    );
  }

  if (includeTvSuggestion && article.tvSuggestion) {
    lines.push('');
    lines.push(`🎬 <b>Gancho TV:</b> ${escapeTelegramHtml(article.tvSuggestion)}`);
  }

  if (includeScore && typeof article.tvScore === 'number') {
    lines.push(`📊 <b>Potencial TV:</b> ${article.tvScore}/100 (${escapeTelegramHtml(article.tvLabel || '')})`);
  }

  if (Array.isArray(article.alsoReportedBy) && article.alsoReportedBy.length > 0) {
    const others = article.alsoReportedBy.map((o) => escapeTelegramHtml(o.sourceShortName || o.sourceName)).join(', ');
    lines.push(`🗞 <i>Também publicado em: ${others}</i>`);
  }

  if (includeLink && article.url) {
    lines.push('');
    lines.push(`🔗 <a href="${escapeTelegramHtml(article.url)}">Ler matéria completa</a>`);
  }

  return lines.join('\n');
}

export function formatBulletinMessages(articles, options = {}) {
  const {
    includeSummary = true,
    includeTvSuggestion = true,
    includeLayaImportance = true,
    includeLink = true,
    headerTitle = 'BOLETIM DA RONDA — NATAL/RN'
  } = options;

  if (!Array.isArray(articles) || articles.length === 0) return [];

  const nowBr = formatBrTime(new Date().toISOString());
  const header = `📋 <b>${escapeTelegramHtml(headerTitle)}</b>\n🕒 <i>${nowBr} • ${articles.length} pauta(s) selecionada(s)</i>\n`;

  const blocks = articles.map((art, index) => {
    const timeStr = formatBrTime(art.publishedAt);
    const layaSuffix =
      includeLayaImportance && art.laya && art.laya.source === 'laya'
        ? ` • Laya: ${escapeTelegramHtml(art.laya.importanceLabel)} (${Math.round(art.laya.importanceScore ?? 0)})`
        : '';
    const parts = [
      `<b>${index + 1}. [${escapeTelegramHtml(art.tvCategory || 'Natal/RN')}] ${escapeTelegramHtml(art.title)}</b>`,
      `<i>${escapeTelegramHtml(art.sourceShortName || art.sourceName)}${timeStr ? ` • ${timeStr}` : ''}${layaSuffix}</i>`
    ];
    if (includeSummary && art.summary) {
      parts.push(escapeTelegramHtml(art.summary.slice(0, 180) + (art.summary.length > 180 ? '…' : '')));
    }
    if (includeTvSuggestion && art.tvSuggestion) {
      parts.push(`🎬 <i>TV:</i> ${escapeTelegramHtml(art.tvSuggestion)}`);
    }
    if (includeLink && art.url) {
      parts.push(`🔗 <a href="${escapeTelegramHtml(art.url)}">Abrir matéria</a>`);
    }
    return parts.join('\n');
  });

  // Chunk below Telegram's 4096 char limit
  const MAX_LEN = 3800;
  const messages = [];
  let current = header;

  for (const block of blocks) {
    const addition = `\n${block}\n`;
    if (current.length + addition.length > MAX_LEN && current !== header) {
      messages.push(current.trim());
      current = `📋 <b>${escapeTelegramHtml(headerTitle)} (cont.)</b>\n${addition}`;
    } else {
      current += addition;
    }
  }
  if (current.trim()) {
    messages.push(current.trim());
  }
  return messages;
}

export async function sendTelegramMessage(botToken, chatId, htmlText, fetchImpl = fetch) {
  const targetChat = String(chatId || '').trim();
  if (!targetChat) {
    throw new Error('ID do grupo/chat do Telegram não configurado.');
  }
  const result = await callTelegramApi(
    botToken,
    'sendMessage',
    {
      chat_id: targetChat,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    },
    fetchImpl
  );
  return {
    messageId: result.message_id,
    chat: result.chat
  };
}

export async function sendTestNotification(botToken, chatId, fetchImpl = fetch) {
  const bot = await verifyBot(botToken, fetchImpl);
  if (!String(chatId || '').trim()) {
    return {
      bot,
      sent: false,
      message: `Bot @${bot.username} validado! Agora informe ou selecione o ID do grupo para testar o envio.`
    };
  }
  const nowBr = formatBrTime(new Date().toISOString());
  const text = [
    '✅ <b>Conexão confirmada — Ronda Jornalística Natal/RN</b>',
    '',
    `🤖 Bot conectado: <b>@${escapeTelegramHtml(bot.username)}</b>`,
    `🕒 Teste realizado em: <i>${nowBr}</i>`,
    '',
    'O envio de pautas e boletins para esta redação está pronto.'
  ].join('\n');

  const delivery = await sendTelegramMessage(botToken, chatId, text, fetchImpl);
  return {
    bot,
    sent: true,
    messageId: delivery.messageId,
    chatTitle: delivery.chat?.title || delivery.chat?.username || String(chatId),
    message: `Mensagem de teste enviada para "${delivery.chat?.title || chatId}" via @${bot.username}!`
  };
}
