function decodeQuotedPrintable(input) {
  return (input || "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBase64Utf8(input) {
  const clean = (input || "").replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean) return "";
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return binary;
  }
}

function decodeMimeBody(body, encoding) {
  const value = (body || "").trim();
  const normalizedEncoding = (encoding || "").toLowerCase();
  if (!value) return "";
  if (normalizedEncoding.includes("base64")) return decodeBase64Utf8(value);
  if (normalizedEncoding.includes("quoted-printable")) return decodeQuotedPrintable(value);
  return value;
}

function extractPreferredContent(rawContent) {
  const normalized = (rawContent || "").replace(/\r\n/g, "\n");
  const boundaryMatch = normalized.match(/boundary="?([^"\n;]+)"?/i);
  let htmlContent = "";
  let plainContent = "";

  if (boundaryMatch) {
    const boundary = "--" + boundaryMatch[1];
    const parts = normalized.split(boundary);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === "--") continue;

      const splitIndex = trimmed.indexOf("\n\n");
      if (splitIndex === -1) continue;

      const headers = trimmed.slice(0, splitIndex);
      const body = trimmed.slice(splitIndex + 2);
      const contentType = (headers.match(/content-type:\s*([^\n]+)/i)?.[1] || "").toLowerCase();
      const encoding = headers.match(/content-transfer-encoding:\s*([^\n]+)/i)?.[1] || "";
      const decoded = decodeMimeBody(body, encoding).trim();

      if (!decoded) continue;
      if (!htmlContent && contentType.includes("text/html")) {
        htmlContent = decoded;
      } else if (!plainContent && contentType.includes("text/plain")) {
        plainContent = decoded;
      }
    }
  }

  if (htmlContent) return htmlContent;
  if (plainContent) return plainContent;

  const fallbackIndex = normalized.indexOf("\n\n");
  return fallbackIndex >= 0 ? normalized.slice(fallbackIndex + 2).trim() : normalized.trim();
}

function decodeHtmlEntities(input) {
  return (input || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripHtmlTags(input) {
  return decodeHtmlEntities(
    (input || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractVerificationCode(content, subject) {
  const rawContent = content || "";
  const subjectText = stripHtmlTags(subject || "");
  const textContent = stripHtmlTags(rawContent);
  const textCombined = [subjectText, textContent].filter(Boolean).join("\n");
  const combined = [subjectText, textContent, rawContent].filter(Boolean).join("\n");
  
  // 1. 优先使用精准正则
  const exactPatterns = [
    /here'?s your github launch code[^0-9]{0,120}([0-9]{6,8})/i,
    /continue signing up for github by entering the code below[^0-9]{0,120}([0-9]{6,8})/i,
    /github launch code[^0-9]{0,120}([0-9]{6,8})/i,
    /account_verifications\/confirm\/[0-9a-f-]+\/([0-9]{6,8})/i,
    /class=["'][^"']*(?:code-box|text-semibold|f00-light)[^"']*["'][^>]*>\s*([0-9]{4,8})\s*<\/(?:span|div)\s*>/i,
    /verification code[^0-9]{0,80}([0-9]{4,8})/i,
    /enter(?:ing)? the code(?: below)?[^0-9]{0,120}([0-9]{4,8})/i,
    /验证码[^0-9]{0,40}([0-9]{4,8})/i
  ];

  for (const pattern of exactPatterns) {
    const match = combined.match(pattern);
    if (match?.[1]) return match[1];
  }

  // 2. 兜底逻辑：优先尝试 8 位和 6 位验证码，避免从原始 HTML 里误提取样式数字
  const excludedCodes = new Set(["2024", "2025", "2026", "24", "48", "600", "94107"]);
  for (const pattern of [/\b([0-9]{8})\b/g, /\b([0-9]{6})\b/g, /\b([0-9]{4,7})\b/g]) {
    const matches = textCombined.matchAll(pattern);
    for (const match of matches) {
      const code = match[1];
      if (excludedCodes.has(code)) continue;
      return code;
    }
  }

  return "未找到";
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    await env.DB.prepare(
      `DELETE FROM messages WHERE created_at < datetime('now', '-5 minute')`
    ).run();

    if (url.pathname === "/api/get-code") {
      const providedKey = url.searchParams.get("key");
      const targetEmail = (url.searchParams.get("email") || "").toLowerCase().trim();

      if (providedKey !== env.SECRET_KEY) {
        return new Response(JSON.stringify({ error: "密钥错误" }), {
          status: 403,
          headers: { "Content-Type": "application/json;charset=UTF-8", ...corsHeaders },
        });
      }

      const result = await env.DB.prepare(
        "SELECT source, subject, content, datetime(created_at, '+8 hours') as local_time FROM messages WHERE address = ? ORDER BY id DESC LIMIT 1"
      ).bind(targetEmail).first();

      if (!result) {
        return new Response(JSON.stringify({ error: "未收到邮件" }), {
          status: 404,
          headers: { "Content-Type": "application/json;charset=UTF-8", ...corsHeaders },
        });
      }

      const code = extractVerificationCode(result.content, result.subject);

      const acceptHeader = request.headers.get("Accept") || "";
      const isBrowser = acceptHeader.includes("text/html");

      if (isBrowser) {
        const html =
          "<!DOCTYPE html>" +
          "<html>" +
          "<head>" +
          '  <meta charset="UTF-8">' +
          "  <title>验证码</title>" +
          "  <style>" +
          "    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }" +
          "    .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; max-width: 420px; }" +
          "    .label { color: #666; font-size: 14px; margin-bottom: 8px; }" +
          "    .email { color: #333; font-size: 16px; margin-bottom: 20px; word-break: break-all; }" +
          "    .source { color: #999; font-size: 12px; margin-bottom: 12px; word-break: break-all; }" +
          "    .code-label { color: #666; font-size: 14px; margin-bottom: 12px; }" +
          "    .code { font-size: 48px; font-weight: bold; color: #667eea; letter-spacing: 8px; margin-bottom: 24px; }" +
          "    .time { color: #999; font-size: 12px; }" +
          "  </style>" +
          "</head>" +
          "<body>" +
          '  <div class="container">' +
          '    <div class="label">邮箱</div>' +
          `    <div class="email">${targetEmail}</div>` +
          `    <div class="source">来源: ${result.source || "未知"}</div>` +
          '    <div class="code-label">验证码</div>' +
          `    <div class="code">${code}</div>` +
          `    <div class="time">${result.local_time} (北京时间)</div>` +
          "  </div>" +
          "</body>" +
          "</html>";

        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html;charset=UTF-8", ...corsHeaders },
        });
      }

      return new Response(
        JSON.stringify({
          email: targetEmail,
          source: result.source,
          subject: result.subject,
          code,
          time: result.local_time,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json;charset=UTF-8", ...corsHeaders },
        }
      );
    }

    return new Response("Service Running", { headers: corsHeaders });
  },

  async email(message, env) {
    await env.DB.prepare(
      `DELETE FROM messages WHERE created_at < datetime('now', '-5 minute')`
    ).run();

    const rawContent = await new Response(message.raw).text();
    const subject = message.headers.get("subject") || "无主题";
    const headerFrom = message.headers.get("from") || "";
    const replyTo = message.headers.get("reply-to") || "";
    const source = headerFrom || replyTo || message.from || "未知发件人";
    const toAddress = (message.to || "").toLowerCase().trim();
    const finalBody = extractPreferredContent(rawContent);

    try {
      await env.DB.prepare(
        "INSERT INTO messages (address, source, subject, content) VALUES (?, ?, ?, ?)"
      ).bind(toAddress, source, subject, finalBody).run();
    } catch (e) {
      console.error(e.message);
    }
  }
};
