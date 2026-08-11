import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

async function readState(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}
export function createFileStorage(file) {
  let queue = Promise.resolve();

  const mutate = operation => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => {});
    return next;
  };

  async function writeState(state) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  return {
    async getItem(key) {
      await queue;
      const state = await readState(file);
      return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null;
    },
    async setItem(key, value) {
      return mutate(async () => {
        const state = await readState(file);
        state[key] = value;
        await writeState(state);
      });
    },
    async removeItem(key) {
      return mutate(async () => {
        const state = await readState(file);
        delete state[key];
        await writeState(state);
      });
    },
  };
}
