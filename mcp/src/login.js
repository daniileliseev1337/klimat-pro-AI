import { emitKeypressEvents } from "node:readline";
import readlinePromises from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createStdioSupabase, normalizeLoginId, requireIdentity } from "./auth.js";
import { loadRuntimeConfig } from "./runtime.js";

async function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Безопасный ввод пароля требует интерактивный терминал; задайте KP_LOGIN_PASSWORD только для этого запуска");
  }
  stdout.write(prompt);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      const onKeypress = (character, key = {}) => {
        if (key.ctrl && key.name === "c") {
          stdin.off("keypress", onKeypress);
          reject(new Error("Вход отменён"));
          return;
        }
        if (key.name === "return" || key.name === "enter") {
          stdin.off("keypress", onKeypress);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (key.name === "backspace") {
          value = value.slice(0, -1);
          return;
        }
        if (!key.ctrl && !key.meta && character) value += character;
      };
      stdin.on("keypress", onKeypress);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

async function main() {
  const config = loadRuntimeConfig();
  const rl = readlinePromises.createInterface({ input: stdin, output: stdout });
  try {
    const loginId = process.env.KP_LOGIN_EMAIL || await rl.question("Email или логин КЛИМАТ-ПРО: ");
    rl.close();
    const password = process.env.KP_LOGIN_PASSWORD || await readHidden("Пароль (ввод скрыт): ");
    if (!loginId.trim() || !password) throw new Error("Логин и пароль обязательны");

    const client = createStdioSupabase(config);
    const { data, error } = await client.auth.signInWithPassword({ email: normalizeLoginId(loginId), password });
    if (error || !data?.user) throw error || new Error("Supabase не вернул пользователя");
    try {
      await requireIdentity(client);
    } catch (identityError) {
      await client.auth.signOut();
      throw identityError;
    }
    stdout.write(`Сессия MCP сохранена для ${data.user.email || data.user.id}. Токены не выводились.\n`);
  } finally {
    rl.close();
  }
}

main().catch(error => {
  process.stderr.write(`Ошибка входа MCP: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
