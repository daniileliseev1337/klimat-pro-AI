class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.call = { kind: "table", table, methods: [] };
  }

  step(name, ...args) {
    this.call.methods.push([name, ...args]);
    return this;
  }

  select(...args) { return this.step("select", ...args); }
  insert(...args) { return this.step("insert", ...args); }
  update(...args) { return this.step("update", ...args); }
  delete(...args) { return this.step("delete", ...args); }
  eq(...args) { return this.step("eq", ...args); }
  lt(...args) { return this.step("lt", ...args); }
  ilike(...args) { return this.step("ilike", ...args); }
  order(...args) { return this.step("order", ...args); }
  limit(...args) { return this.step("limit", ...args); }
  in(...args) { return this.step("in", ...args); }
  maybeSingle() { this.step("maybeSingle"); return this.finish(); }
  single() { this.step("single"); return this.finish(); }

  finish() {
    this.client.calls.push(this.call);
    return Promise.resolve(this.client.responses.shift() || { data: null, error: null });
  }

  then(resolve, reject) {
    return this.finish().then(resolve, reject);
  }
}

export function fakeSupabase(responses = [], user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test" }) {
  const client = {
    calls: [], responses: [...responses],
    from(table) { return new FakeQuery(client, table); },
    async rpc(name, args = {}) {
      client.calls.push({ kind: "rpc", name, args });
      return client.responses.shift() || { data: null, error: null };
    },
    functions: {
      async invoke(name, options = {}) {
        client.calls.push({ kind: "function", name, options });
        return client.responses.shift() || { data: null, error: null };
      },
    },
    auth: { async getUser() { return { data: { user }, error: null }; } },
  };
  return client;
}
