import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase.js";
import { loadMyMcpAccess, mcpAccessLabel } from "../lib/mcpAccess.js";

const normalizeLogin = value => {
  const login = String(value || "").trim().toLowerCase();
  return login.includes("@") ? login : `${login}@klimat.local`;
};

export default function OAuthConsentPage() {
  const authorizationId = useMemo(() => new URLSearchParams(window.location.search).get("authorization_id"), []);
  const [session, setSession] = useState(null);
  const [details, setDetails] = useState(null);
  const [accessLevel, setAccessLevel] = useState("none");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => active && setSession(data.session || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!authorizationId) { setError("Отсутствует authorization_id"); setBusy(false); return; }
    if (!session?.user?.id) { setBusy(false); return; }
    setBusy(true);
    Promise.all([
      supabase.auth.oauth.getAuthorizationDetails(authorizationId),
      loadMyMcpAccess(supabase, session.user.id),
    ]).then(([oauth, level]) => {
      if (oauth.error) throw oauth.error;
      setDetails(oauth.data);
      setAccessLevel(level);
      setError("");
    }).catch(e => setError(e.message || "Не удалось загрузить запрос доступа"))
      .finally(() => setBusy(false));
  }, [authorizationId, session?.user?.id]);

  const signIn = async event => {
    event.preventDefault(); setBusy(true); setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizeLogin(login), password });
    if (signInError) { setError("Неверный логин или пароль"); setBusy(false); }
  };

  const decide = async approve => {
    setBusy(true); setError("");
    const result = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (result.error) { setError(result.error.message); setBusy(false); return; }
    window.location.assign(result.data.redirect_url);
  };

  const clientName = details?.client?.name || details?.client_name || "MCP-клиент";
  const scopes = details?.scope || details?.scopes?.join?.(" ") || "email profile offline_access";

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 18, background: "#080909", color: "#fafaf7" }}>
      <section style={{ width: "min(100%, 520px)", padding: 24, borderRadius: 18, background: "#151614", border: "1px solid rgba(212,175,55,.3)", boxShadow: "0 25px 80px rgba(0,0,0,.55)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <ShieldCheck color="#d4af37" />
          <div><b>Подключение к КЛИМАТ-ПРО</b><div style={{ color: "#9a9a95", fontSize: 12 }}>Безопасный OAuth-доступ для LLM</div></div>
        </div>

        {!session ? (
          <form onSubmit={signIn} style={{ display: "grid", gap: 10 }}>
            <p style={{ color: "#cfcfca", fontSize: 13 }}>Войдите своим логином сайта. Пароль не передаётся MCP-клиенту.</p>
            <input aria-label="Логин" value={login} onChange={e => setLogin(e.target.value)} placeholder="Логин или email" required style={inputStyle} />
            <input aria-label="Пароль" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль" required style={inputStyle} />
            <button disabled={busy} style={primaryStyle}>{busy ? "Входим…" : "Войти"}</button>
          </form>
        ) : busy ? <p>Проверяем доступ…</p> : (
          <div>
            <p style={{ color: "#cfcfca", lineHeight: 1.55 }}><b>{clientName}</b> запрашивает доступ к данным сайта от имени <b>{session.user.email}</b>.</p>
            <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,.035)", fontSize: 13, lineHeight: 1.6 }}>
              <div>Разрешение администратора: <b style={{ color: accessLevel === "none" ? "#f8a3a3" : "#d4af37" }}>{mcpAccessLabel(accessLevel)}</b></div>
              <div style={{ color: "#8a8a85", fontSize: 11 }}>OAuth scopes: {scopes}</div>
              {accessLevel === "write" && <div>Изменения выполняются только после отдельного preview и подтверждения.</div>}
            </div>
            {accessLevel === "none" ? (
              <>
                <p style={{ color: "#f8a3a3", fontSize: 13 }}>Администратор ещё не выдал этому аккаунту MCP-доступ.</p>
                <button onClick={() => decide(false)} style={secondaryStyle}>Закрыть запрос</button>
              </>
            ) : (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button onClick={() => decide(false)} style={secondaryStyle}>Отказать</button>
                <button onClick={() => decide(true)} style={primaryStyle}>Разрешить подключение</button>
              </div>
            )}
            <button onClick={() => supabase.auth.signOut()} disabled={busy} style={{ ...secondaryStyle, width: "100%", marginTop: 10 }}>
              Войти другим аккаунтом
            </button>
          </div>
        )}
        {error && <p role="alert" style={{ color: "#f8a3a3", fontSize: 13 }}>{error}</p>}
      </section>
    </main>
  );
}

const inputStyle = { padding: "11px 12px", borderRadius: 9, border: "1px solid rgba(255,255,255,.12)", background: "#0e0f0f", color: "#fafaf7", font: "inherit" };
const primaryStyle = { flex: 1, padding: "10px 14px", borderRadius: 9, border: 0, background: "#d4af37", color: "#090909", fontWeight: 700, cursor: "pointer" };
const secondaryStyle = { ...primaryStyle, background: "transparent", color: "#cfcfca", border: "1px solid rgba(255,255,255,.12)" };
