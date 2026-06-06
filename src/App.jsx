import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./lib/supabase";
import { diffLines } from "./lib/lineDiff";
import { isPushSupported, getPushState, enablePush, disablePush } from "./lib/push";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, FolderKanban, Wallet, BarChart3,
  Plus, Pencil, Trash2, X, Check, Calendar, AlertTriangle,
  CheckCircle2, Clock, FileText, Package, LogOut,
  FolderInput, Cloud, User, Users, Hourglass, Inbox,
  ChevronRight, Eye, Sparkles, TrendingUp, TrendingDown,
  ScissorsLineDashed, ArrowDownToLine, Search, Filter,
  CircleAlert, Coffee, ShoppingCart, Pill, Music,
  Briefcase, Receipt, BadgeCheck, Loader2, Mail,
  Phone, Send, ExternalLink,
  // ── v1.5: иконки для админ-панели, команды, клиентов, прав ──
  ShieldCheck, Crown, PencilLine, UserPlus, UserMinus, UserCheck, KeyRound,
  Building2, MapPin, Hash, Star, Activity, ScrollText, BookUser,
  ChevronDown, IdCard, Phone as PhoneIcon,
  // ── v2.0: иконки маркетплейса, комментариев, файлов ──
  Globe, Store, Undo2, MessageSquare,
  Paperclip, Download, HardDrive, FileImage, Lock, Unlock,
  // ── v6.4a: вкладка Задачи ──
  ListTodo,
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LineChart, Line,
  ResponsiveContainer
} from "recharts";

// ════════════════════════════════════════════════════════════════════════════
// HOOKS — общие утилиты
// ════════════════════════════════════════════════════════════════════════════
// useIsMobile — реактивный детект мобильной ширины (≤640px) для случаев,
// где CSS-значений (auto-fit / clamp / min) недостаточно и нужна иная раскладка.
function useIsMobile(){
  const [m,setM]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(max-width:640px)').matches);
  useEffect(()=>{
    const mq=window.matchMedia('(max-width:640px)');
    const h=e=>setM(e.matches);
    mq.addEventListener('change',h);
    return()=>mq.removeEventListener('change',h);
  },[]);
  return m;
}

// ════════════════════════════════════════════════════════════════════════════
// SUPABASE: ПОДКЛЮЧЕНИЕ
// ════════════════════════════════════════════════════════════════════════════
// Singleton client вынесен в src/lib/supabase.js — общий для всего приложения.
// Здесь только импорт.

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS — справочники проекта
// ════════════════════════════════════════════════════════════════════════════
const PROJECT_STAGES = [
  "Поиск исполнителя","Переговоры","КП выслано","Договор подписан",
  "В работе","Сдан заказчику","Оплачен","Архив"
];
const PROJECT_TYPES = [
  "ОВиК","Слаботочка","BIM","Исполнительная документация",
  "Электрика","ВК","Прочее"
];
const INCOME_CATS = [
  "Зарплата К-7","Проектирование","Исполнительная документация",
  "Консультация","Прочий доход"
];
const EXPENSE_CATS = [
  "Жильё / аренда","Транспорт","Такси","Питание","Кофе",
  "Здоровье / аптека","Обучение / курсы","ПО и инструменты",
  "Связь","Развлечения","Кредит / займы","Табак",
  "Партнёр","Семья","Питомцы","Дети","Подарки","Прочие расходы"
];

const STAGE_META = {
  "Поиск исполнителя": { color:"#93c5fd", progress:0   },
  "Переговоры":        { color:"#6b6b67", progress:10  },
  "КП выслано":       { color:"#93c5fd", progress:25  },
  "Договор подписан": { color:"#d4af37", progress:40  },
  "В работе":         { color:"#d4af37", progress:65  },
  "Сдан заказчику":   { color:"#6ee7a8", progress:85  },
  "Оплачен":          { color:"#6ee7a8", progress:100 },
  "Архив":            { color:"#1c1c1a", progress:100 },
};

const PALETTE = ["#d4af37","#d4af37","#f59e0b","#6ee7a8","#f8a3a3","#8b5cf6","#ec4899","#f97316"];

// Старые ключи window.storage — для попытки автоматического переноса данных
// из предыдущей версии артефакта на этапе миграции
const LEGACY_KEY_PROJECTS = "dash2_projects";
const LEGACY_KEY_TXS      = "dash2_txs";

// ════════════════════════════════════════════════════════════════════════════
// UTILS — мелкие хелперы
// ════════════════════════════════════════════════════════════════════════════
const fmt      = n  => new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",maximumFractionDigits:0}).format(+n||0);
const fmtD     = d  => d ? new Date(d+"T00:00:00").toLocaleDateString("ru-RU") : "—";
const fmtDT    = dt => dt ? new Date(dt).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "";
const todayStr = () => new Date().toISOString().slice(0,10);
const fmtSize  = b  => b >= 1048576 ? `${(b/1048576).toFixed(1)} МБ` : b >= 1024 ? `${(b/1024).toFixed(0)} КБ` : `${b} Б`;

// ════════════════════════════════════════════════════════════════════════════
// FIELD MAPPING — переводчик между БД (snake_case) и JS UI (camelCase)
// ════════════════════════════════════════════════════════════════════════════
// Принцип: компоненты UI продолжают работать с теми же именами полей, что и
// раньше (contractSum, paidAmount, startDate). База использует snake_case
// согласно SQL-конвенции. Эти функции — переходные адаптеры между мирами.
// ----------------------------------------------------------------------------

function projectDbToJs(row) {
  return {
    id:             row.id,
    name:           row.name || "",
    client:         row.client || "",
    executor:       row.executor || "",
    type:           row.type || "ОВиК",
    stage:          row.stage || "Переговоры",
    startDate:      row.start_date || "",
    deadline:       row.deadline || "",
    contractSum:    row.contract_sum != null ? Number(row.contract_sum) : 0,
    paidAmount:     row.paid_amount  != null ? Number(row.paid_amount)  : 0,
    notes:          row.notes || "",
    visibility:     row.visibility || "private",
    ownerId:        row.owner_id,
    // Поля v1.2 — ссылки и контакты
    links:          Array.isArray(row.links) ? row.links : [],
    clientPhone:    row.client_phone || "",
    clientEmail:    row.client_email || "",
    clientTelegram: row.client_telegram || "",
    // Поля v1.5 — связь с записью клиента
    clientId:       row.client_id || null,
    // Поля v2.0 — маркетплейс
    takenBy:        row.taken_by || null,
  };
}

function projectJsToDb(p, ownerId) {
  return {
    name:             p.name || "Без названия",
    client:           p.client || null,
    executor:         p.executor || null,
    type:             p.type || null,
    stage:            p.stage || "Переговоры",
    start_date:       p.startDate || null,
    deadline:         p.deadline || null,
    contract_sum:     parseFloat(p.contractSum) || 0,
    paid_amount:      parseFloat(p.paidAmount)  || 0,
    notes:            p.notes || null,
    visibility:       p.visibility || "private",
    owner_id:         ownerId,
    links: (Array.isArray(p.links) ? p.links : [])
      .filter(l => l && l.url && l.url.trim())
      .map(l => ({
        title: (l.title || "").trim() || "Ссылка",
        url:   l.url.trim(),
      })),
    client_phone:     p.clientPhone ? p.clientPhone.trim() : null,
    client_email:     p.clientEmail ? p.clientEmail.trim() : null,
    client_telegram:  p.clientTelegram ? p.clientTelegram.trim().replace(/^@/, "") : null,
    client_id:        p.clientId || null,
  };
}

// ── v3.0 6.4a: задачи ──
function taskDbToJs(r) {
  return {
    id: r.id, projectId: r.project_id, projectName: r.project_name ?? null,
    authorId: r.author_id, authorName: r.author_name ?? null,
    assignedTo: r.assigned_to, assigneeName: r.assignee_name ?? null,
    title: r.title, description: r.description ?? "",
    status: r.status, priority: r.priority,
    dueDate: r.due_date, sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function taskJsToDb(t) {
  const o = {};
  if (t.projectId !== undefined) o.project_id = t.projectId || null;
  if (t.assignedTo !== undefined) o.assigned_to = t.assignedTo || null;
  if (t.title !== undefined) o.title = t.title;
  if (t.description !== undefined) o.description = t.description;
  if (t.status !== undefined) o.status = t.status;
  if (t.priority !== undefined) o.priority = t.priority;
  if (t.dueDate !== undefined) o.due_date = t.dueDate || null;
  if (t.sortOrder !== undefined) o.sort_order = t.sortOrder;
  return o;
}
export const TASK_STATUSES = ["Новая", "В работе", "На проверке", "Готово", "Отменена"];
export const TASK_PRIORITIES = ["Низкий", "Обычный", "Высокий"];
const TASK_STATUS_BADGE = {
  "Новая": "bg-zinc-600", "В работе": "bg-amber-600", "На проверке": "bg-sky-600",
  "Готово": "bg-emerald-600", "Отменена": "bg-zinc-800",
};

// ── v3.0 6.4b: версии ТЗ и комментарии задач ──
function versionDbToJs(r) {
  return {
    id: r.id, taskId: r.task_id, versionNo: r.version_no,
    content: r.content ?? "", status: r.status,
    proposedBy: r.proposed_by, proposedByName: r.proposed_by_name ?? "Пользователь",
    resolvedBy: r.resolved_by ?? null, resolvedByName: r.resolved_by_name ?? null,
    createdAt: r.created_at, resolvedAt: r.resolved_at ?? null,
  };
}
function commentDbToJs(r) {
  return {
    id: r.id, taskId: r.task_id,
    authorId: r.author_id, authorName: r.author_name ?? "Пользователь",
    body: r.body ?? "", isQuestion: !!r.is_question, resolved: !!r.resolved,
    resolvedBy: r.resolved_by ?? null, resolvedByName: r.resolved_by_name ?? null,
    resolvedAt: r.resolved_at ?? null, createdAt: r.created_at,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Маппинг записей клиентской базы (v1.5)
// ────────────────────────────────────────────────────────────────────────
function clientDbToJs(row) {
  return {
    id:          row.id,
    ownerId:     row.owner_id,
    name:        row.name || "",
    phone:       row.phone || "",
    email:       row.email || "",
    telegram:    row.telegram || "",
    clientType:  row.client_type || "individual",
    category:    row.category || "regular",
    legalName:   row.legal_name || "",
    inn:         row.inn || "",
    address:     row.address || "",
    city:        row.city || "",
    notes:       row.notes || "",
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

function clientJsToDb(c, ownerId) {
  return {
    owner_id:    ownerId,
    name:        (c.name || "").trim() || "Без имени",
    phone:       c.phone ? c.phone.trim() : null,
    email:       c.email ? c.email.trim() : null,
    telegram:    c.telegram ? c.telegram.trim().replace(/^@/, "") : null,
    client_type: c.clientType || "individual",
    category:    c.category || "regular",
    legal_name:  c.legalName ? c.legalName.trim() : null,
    inn:         c.inn ? c.inn.trim() : null,
    address:     c.address ? c.address.trim() : null,
    city:        c.city ? c.city.trim() : null,
    notes:       c.notes ? c.notes.trim() : null,
  };
}

function txDbToJs(row) {
  return {
    id:          row.id,
    date:        row.date,
    type:        row.type,
    category:    row.category,
    amount:      Number(row.amount) || 0,
    description: row.description || "",
    ownerId:     row.owner_id,
  };
}

function txJsToDb(t, ownerId) {
  return {
    date:        t.date || todayStr(),
    type:        t.type === "income" ? "income" : "expense",
    category:    t.category || "Прочие расходы",
    amount:      parseFloat(t.amount) || 0,
    description: t.description || null,
    owner_id:    ownerId,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DATA OPERATIONS — обёртки над Supabase API
// ════════════════════════════════════════════════════════════════════════════
// Все запросы к БД централизованы здесь. Если Supabase когда-то изменит API
// или мы захотим заменить бэкенд — менять придётся только этот блок.
// ----------------------------------------------------------------------------

async function fetchProjects(client) {
  const { data, error } = await client
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(projectDbToJs);
}

async function fetchTransactions(client) {
  const { data, error } = await client
    .from("transactions")
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map(txDbToJs);
}

async function insertProject(client, project, ownerId) {
  const dbObj = projectJsToDb(project, ownerId);
  const { data, error } = await client
    .from("projects")
    .insert(dbObj)
    .select()
    .single();
  if (error) throw error;
  return projectDbToJs(data);
}

async function updateProject(client, id, project, ownerId) {
  const dbObj = projectJsToDb(project, ownerId);
  const { data, error } = await client
    .from("projects")
    .update(dbObj)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return projectDbToJs(data);
}

async function deleteProjectDb(client, id) {
  const { error } = await client.from("projects").delete().eq("id", id);
  if (error) throw error;
}

// ── v2.0: функции маркетплейса ────────────────────────────────────────────

async function takeProject(client, projectId) {
  const { error } = await client.rpc("take_project", { p_project_id: projectId });
  if (error) throw error;
}

async function releaseProject(client, projectId) {
  const { error } = await client.rpc("release_project", { p_project_id: projectId });
  if (error) throw error;
}

async function revokeProject(client, projectId) {
  const { error } = await client.rpc("revoke_project", { p_project_id: projectId });
  if (error) throw error;
}

async function setProjectVisibilityUsers(client, projectId, userIds) {
  const { error } = await client.rpc("set_project_visibility_users", {
    p_project_id: projectId,
    p_user_ids: userIds,
  });
  if (error) throw error;
}

async function getProjectVisibilityUsers(client, projectId) {
  const { data, error } = await client.rpc("get_project_visibility_users", {
    p_project_id: projectId,
  });
  if (error) throw error;
  return data || [];
}

// ── v2.0: функции комментариев ────────────────────────────────────────────

async function fetchProjectComments(client, projectId) {
  const { data, error } = await client.rpc("get_project_comments", {
    p_project_id: projectId,
  });
  if (error) throw error;
  return (data || []).map(r => ({
    id:          r.id,
    projectId:   r.project_id,
    authorId:    r.author_id,
    authorName:  r.author_name || "Пользователь",
    authorEmail: r.author_email || "",
    content:     r.content,
    resolved:    r.resolved,
    resolvedAt:  r.resolved_at,
    createdAt:   r.created_at,
  }));
}

async function insertProjectComment(client, projectId, content) {
  const { error } = await client
    .from("project_comments")
    .insert({ project_id: projectId, author_id: (await client.auth.getUser()).data.user.id, content });
  if (error) throw error;
}

async function resolveProjectComment(client, commentId, resolved = true) {
  const { error } = await client.rpc("resolve_project_comment", {
    p_comment_id: commentId,
    p_resolved:   resolved,
  });
  if (error) throw error;
}

async function deleteProjectComment(client, commentId) {
  const { error } = await client.rpc("delete_project_comment", {
    p_comment_id: commentId,
  });
  if (error) throw error;
}

async function insertTransaction(client, tx, ownerId) {
  const dbObj = txJsToDb(tx, ownerId);
  const { data, error } = await client
    .from("transactions")
    .insert(dbObj)
    .select()
    .single();
  if (error) throw error;
  return txDbToJs(data);
}

async function insertTransactionsBulk(client, txs, ownerId) {
  // Для импорта банковских выписок и миграции — пакетная вставка
  if (!txs.length) return [];
  const dbRows = txs.map(t => txJsToDb(t, ownerId));
  const { data, error } = await client
    .from("transactions")
    .insert(dbRows)
    .select();
  if (error) throw error;
  return (data || []).map(txDbToJs);
}

async function insertProjectsBulk(client, projects, ownerId) {
  if (!projects.length) return [];
  const dbRows = projects.map(p => projectJsToDb(p, ownerId));
  const { data, error } = await client
    .from("projects")
    .insert(dbRows)
    .select();
  if (error) throw error;
  return (data || []).map(projectDbToJs);
}

async function updateTransaction(client, id, tx, ownerId) {
  const dbObj = txJsToDb(tx, ownerId);
  const { data, error } = await client
    .from("transactions")
    .update(dbObj)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return txDbToJs(data);
}

async function deleteTransactionDb(client, id) {
  const { error } = await client.from("transactions").delete().eq("id", id);
  if (error) throw error;
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENTS (v1.5) — операции с клиентской базой
// ════════════════════════════════════════════════════════════════════════════

async function fetchClients(client) {
  const { data, error } = await client
    .from("clients")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map(clientDbToJs);
}

async function insertClient(client, c, ownerId) {
  const dbObj = clientJsToDb(c, ownerId);
  const { data, error } = await client
    .from("clients")
    .insert(dbObj)
    .select()
    .single();
  if (error) throw error;
  return clientDbToJs(data);
}

async function updateClient(client, id, c, ownerId) {
  const dbObj = clientJsToDb(c, ownerId);
  const { data, error } = await client
    .from("clients")
    .update(dbObj)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return clientDbToJs(data);
}

async function deleteClientDb(client, id) {
  const { error } = await client.from("clients").delete().eq("id", id);
  if (error) throw error;
}

async function searchClientsByQuery(client, query) {
  const { data, error } = await client.rpc("search_clients", { p_query: query || "" });
  if (error) throw error;
  return data || [];
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECT MEMBERS (v1.5) — управление командой проекта
// ════════════════════════════════════════════════════════════════════════════

async function fetchProjectMembers(client, projectId) {
  const { data, error } = await client.rpc("get_project_members", { p_project_id: projectId });
  if (error) throw error;
  return data || [];
}

async function addProjectMember(client, projectId, userId, role = "viewer") {
  const { data, error } = await client
    .from("project_members")
    .insert({ project_id: projectId, user_id: userId, role })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateProjectMemberRole(client, projectId, userId, role) {
  const { error } = await client
    .from("project_members")
    .update({ role })
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw error;
}

async function removeProjectMember(client, projectId, userId) {
  const { error } = await client
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);
  if (error) throw error;
}

async function searchApprovedUsers(client, query) {
  const { data, error } = await client.rpc("search_approved_users", { p_query: query || "" });
  if (error) throw error;
  return data || [];
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN (v1.5) — административные операции
// ════════════════════════════════════════════════════════════════════════════

async function adminListUsers(client) {
  const { data, error } = await client.rpc("admin_list_users");
  if (error) throw error;
  return data || [];
}

async function adminUpdateUser(client, userId, updates) {
  const { error } = await client.rpc("admin_update_user", {
    p_user_id: userId,
    p_approved: updates.approved !== undefined ? updates.approved : null,
    p_role: updates.role || null,
    p_name: updates.name !== undefined ? updates.name : null,
  });
  if (error) throw error;
}

async function adminDeleteUser(client, userId) {
  const { error } = await client.rpc("admin_delete_user", { p_user_id: userId });
  if (error) throw error;
}

async function adminSystemStats(client) {
  const { data, error } = await client.rpc("admin_system_stats");
  if (error) throw error;
  return data || {};
}

// Сброс пароля пользователя администратором (без SMTP). Защита — is_admin() внутри RPC.
async function adminResetPassword(client, userId, newPassword) {
  const { error } = await client.rpc("admin_reset_password", {
    p_user_id: userId,
    p_new_password: newPassword,
  });
  if (error) throw error;
}

async function adminFetchActivityLog(client, limit = 50) {
  const { data, error } = await client
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function fetchTopClients(client, limit = 5) {
  const { data, error } = await client.rpc("top_clients", { p_limit: limit });
  if (error) throw error;
  return data || [];
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH — обёртки над supabase.auth и проверка профиля
// ════════════════════════════════════════════════════════════════════════════

async function fetchProfile(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

// ── v2.0: Telegram-функции ────────────────────────────────────────────────

async function generateTelegramLinkCode(client) {
  const { data, error } = await client.rpc("generate_telegram_link_code");
  if (error) throw error;
  return data; // строка — 8-символьный код
}

async function unlinkTelegram(client) {
  const { error } = await client.rpc("unlink_telegram");
  if (error) throw error;
}

async function updateNotificationSettings(client, settings) {
  const { error } = await client.rpc("update_notification_settings", {
    p_project_taken: settings.notifProjectTaken,
    p_team_invite:   settings.notifTeamInvite,
    p_comment:       settings.notifComment,
    p_deadline:      settings.notifDeadline,
    p_notif_task:    settings.notifTask,
  });
  if (error) throw error;
}

// Отправка Web Push уведомления через Edge Function (заменяет Telegram-канал).
// Ошибки подавляются — уведомления best-effort.
async function sendPush(client, type, recipientId, data = {}) {
  try {
    await client.functions.invoke("web-push-notify", {
      body: { type, recipientId, ...data },
    });
  } catch (e) {
    console.warn("Push notify failed:", e);
  }
}

// ── v3.0 6.4a: задачи — API-функции ──
async function fetchTasks(client, { projectId = null, status = null, assignedTo = null } = {}) {
  const { data, error } = await client.rpc("get_tasks", {
    p_project_id: projectId, p_status: status, p_assigned_to: assignedTo,
  });
  if (error) throw error;
  return (data || []).map(taskDbToJs);
}
async function createTask(client, t, authorId) {
  const row = { ...taskJsToDb(t), author_id: authorId };
  const { data, error } = await client.from("project_tasks").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}
async function updateTask(client, id, patch) {
  const { error } = await client.from("project_tasks").update(taskJsToDb(patch)).eq("id", id);
  if (error) throw error;
}
async function deleteTask(client, id) {
  const { error } = await client.from("project_tasks").delete().eq("id", id);
  if (error) throw error;
}
async function notifyTask(client, type, taskId, initiatorId) {
  try {
    await client.functions.invoke("web-push-notify", { body: { type, taskId, initiatorId } });
  } catch (e) { console.warn("task notify failed:", e); }
}

// ── v3.0 6.4b: версии ТЗ — API-обёртки (RPC Плана 1) ──
async function fetchTaskVersions(client, taskId) {
  const { data, error } = await client.rpc("get_task_versions", { p_task_id: taskId });
  if (error) throw error;
  return (data || []).map(versionDbToJs);
}
async function proposeTzVersion(client, taskId, content) {
  const { data, error } = await client.rpc("propose_tz_version", { p_task_id: taskId, p_content: content });
  if (error) throw error;
  return versionDbToJs(data);
}
async function approveTzVersion(client, versionId) {
  const { data, error } = await client.rpc("approve_tz_version", { p_version_id: versionId });
  if (error) throw error;
  return versionDbToJs(data);
}
async function rejectTzVersion(client, versionId) {
  const { data, error } = await client.rpc("reject_tz_version", { p_version_id: versionId });
  if (error) throw error;
  return versionDbToJs(data);
}

// ── v3.0 6.4b: обсуждение задачи + смена статуса ──
async function fetchTaskComments(client, taskId) {
  const { data, error } = await client.rpc("get_task_comments", { p_task_id: taskId });
  if (error) throw error;
  return (data || []).map(commentDbToJs);
}
async function insertTaskComment(client, taskId, body, isQuestion) {
  const uid = (await client.auth.getUser()).data.user.id;
  const { error } = await client.from("task_comments").insert({
    task_id: taskId, author_id: uid, body, is_question: !!isQuestion,
  });
  if (error) throw error;
}
async function resolveTaskQuestion(client, commentId, resolved) {
  const { data, error } = await client.rpc("resolve_question", { p_comment_id: commentId, p_resolved: !!resolved });
  if (error) throw error;
  return commentDbToJs(data);
}
async function setTaskStatus(client, taskId, status) {
  const { data, error } = await client.rpc("set_task_status", { p_task_id: taskId, p_status: status });
  if (error) throw error;
  return taskDbToJs(data);
}

// ── v3.0: Nextcloud — функции файлового хранилища ────────────────────────
// Доступ к файлам идёт через Edge Function `nextcloud` (Nextcloud наружу не
// выставлен). Права проверяются в функции через RLS под JWT пользователя.

async function ncAction(client, action, payload = {}) {
  const { data, error } = await client.functions.invoke("nextcloud", {
    body: { action, ...payload },
  });
  if (error) throw error;
  return data;
}

async function fetchProjectFiles(client, projectId) {
  const { data, error } = await client.rpc("get_project_files", { p_project_id: projectId });
  if (error) throw error;
  return data || [];
}

async function uploadProjectFile(client, projectId, file, isPublic) {
  // Бинарная загрузка: шлём сырой File (стримится), метаданные — в заголовках.
  // НЕ читаем файл в base64 — иначе worker Edge Function упирается в memory limit.
  const { data, error } = await client.functions.invoke("nextcloud", {
    body: file,
    headers: {
      "x-action":     "upload",
      "x-project-id": projectId,
      "x-filename":   encodeURIComponent(file.name),
      "x-mime-type":  file.type || "application/octet-stream",
      "x-file-size":  String(file.size),
    },
  });
  if (error) throw error;
  return data;
}

// Nextcloud внутренний — прямой ссылки нет: функция стримит файл, получаем Blob.
async function downloadProjectFile(client, fileId) {
  const { data, error } = await client.functions.invoke("nextcloud", {
    body: { action: "download", id: fileId },
  });
  if (error) throw error;
  if (data instanceof Blob) return data;
  if (typeof data === "string") return new Blob([data]);
  if (data instanceof ArrayBuffer) return new Blob([data]);
  throw new Error("Не удалось получить файл");
}

async function toggleFilePublic(client, fileId, makePublic) {
  return ncAction(client, "toggle-public", { id: fileId, makePublic });
}

async function deleteProjectFile(client, fileId) {
  return ncAction(client, "delete", { id: fileId });
}

async function signInWithPassword(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signUpWithPassword(client, email, password) {
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signOut(client) {
  await client.auth.signOut();
}

// Перевод стандартных ошибок Supabase в дружелюбные русские сообщения
function translateAuthError(err) {
  const msg = (err?.message || "").toLowerCase();
  if (msg.includes("invalid login credentials"))     return "Неверный email или пароль";
  if (msg.includes("email not confirmed"))           return "Email не подтверждён — проверь почту";
  if (msg.includes("user already registered"))       return "Пользователь с таким email уже существует";
  if (msg.includes("password should be at least"))   return "Пароль слишком короткий (минимум 6 символов)";
  if (msg.includes("invalid email"))                 return "Неверный формат email";
  if (msg.includes("rate limit"))                    return "Слишком много попыток. Подожди минуту";
  if (msg.includes("network") || msg.includes("fetch")) return "Нет связи с сервером. Проверь интернет";
  return err?.message || "Произошла ошибка";
}

// ════════════════════════════════════════════════════════════════════════════
// STYLED INPUTS — обновлённые под новую цветовую палитру Linear-стиля
// ════════════════════════════════════════════════════════════════════════════
// Используем инлайн-стили, потому что Tailwind не перебивает -webkit-text-fill-color.
// Это свойство — единственный надёжный способ сделать текст белым в iOS Safari.
const BASE_INPUT = {
  background: "#0a0b11",
  color: "#f7f8f8",
  WebkitTextFillColor: "#f7f8f8",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
  colorScheme: "dark",
  transition: "all 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
  fontFamily: "inherit",
};

function StyledInput(props) {
  const [focused, setFocused] = useState(false);
  const { style = {}, ...rest } = props;
  return (
    <input
      {...rest}
      style={{
        ...BASE_INPUT,
        border: `1px solid ${focused ? "#d4af37" : "rgba(255,255,255,0.10)"}`,
        boxShadow: focused ? "0 0 0 3px rgba(212,175,55,0.18)" : "none",
        ...style,
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}
function StyledSelect(props) {
  const [focused, setFocused] = useState(false);
  const { style = {}, ...rest } = props;
  return (
    <select
      {...rest}
      style={{
        ...BASE_INPUT,
        border: `1px solid ${focused ? "#d4af37" : "rgba(255,255,255,0.10)"}`,
        boxShadow: focused ? "0 0 0 3px rgba(212,175,55,0.18)" : "none",
        appearance: "none",
        cursor: "pointer",
        ...style,
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}
function StyledTextarea(props) {
  const [focused, setFocused] = useState(false);
  const { style = {}, ...rest } = props;
  return (
    <textarea
      {...rest}
      style={{
        ...BASE_INPUT,
        border: `1px solid ${focused ? "#d4af37" : "rgba(255,255,255,0.10)"}`,
        boxShadow: focused ? "0 0 0 3px rgba(212,175,55,0.18)" : "none",
        resize: "vertical",
        ...style,
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ANIMATED NUMBER — компонент плавно прокручивающихся цифр
// ════════════════════════════════════════════════════════════════════════════
// Принимает целевое значение и опциональную функцию форматирования.
// При первом монтировании или при изменении значения плавно анимирует
// от текущего отображаемого значения к новому за 700ms с easing-кривой
// easeOutCubic (быстрое начало, плавное замедление к концу).
//
// Это создаёт эффект "живых данных" — когда страница загружается,
// цифры не появляются мгновенно, а быстро прокручиваются от нуля
// до своего реального значения, как табло на бирже. Эффект занимает
// доли секунды, но создаёт ощущение пульсирующего инструмента.
function AnimatedNumber({ value, format, duration = 700 }) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    const startValue = prevValue.current;
    const endValue = Number(value) || 0;
    if (startValue === endValue) return;

    const startTime = Date.now();
    let rafId;
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // easeOutCubic — быстрое начало, плавное замедление к концу
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(startValue + (endValue - startValue) * eased);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        prevValue.current = endValue;
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, duration]);

  return <>{format ? format(display) : Math.round(display)}</>;
}

// ════════════════════════════════════════════════════════════════════════════
// PRIMITIVE UI — базовые строительные блоки в новой эстетике
// ════════════════════════════════════════════════════════════════════════════
const BTN = {
  primary: "px-4 py-2 rounded-lg bg-[#d4af37] hover:bg-[#e8c860] text-[#0a0a0a] text-sm font-semibold transition-all duration-200 active:scale-[0.98]",
  ghost: "px-4 py-2 rounded-lg border border-white/10 text-[#9b9ca4] hover:text-white hover:border-white/20 text-sm font-medium transition-all duration-200 active:scale-[0.98]",
  danger: "px-2 py-1 rounded text-[#62646b] hover:text-[#f8a3a3] text-sm transition-colors duration-200",
  edit: "px-2 py-1 rounded text-[#62646b] hover:text-[#d4af37] text-sm transition-colors duration-200",
};

function Label({ children }) {
  return (
    <p style={{
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: "0.10em",
      color: "#62646b",
      marginBottom: 6,
      fontWeight: 600,
      margin: "0 0 6px 0",
    }}>{children}</p>
  );
}

function Field({ label, children, style = {} }) {
  return <div style={{ marginBottom: 14, ...style }}><Label>{label}</Label>{children}</div>;
}

// Базовая карточка — фон чуть светлее основного, тонкая граница, скруглённые углы
function Card({ children, style = {}, glass = false }) {
  if (glass) {
    return (
      <div
        className="glass-card"
        style={{ borderRadius: 14, padding: 18, ...style }}
      >
        {children}
      </div>
    );
  }
  return (
    <div style={{
      background: "#141414",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 14,
      padding: 18,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children, icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {icon && <span style={{ color: "#62646b", display: "flex" }}>{icon}</span>}
      <p style={{
        fontSize: 11,
        fontWeight: 600,
        color: "#9b9ca4",
        textTransform: "uppercase",
        letterSpacing: "0.10em",
        margin: 0,
      }}>{children}</p>
    </div>
  );
}

// Чип-фильтр — нажимная пилюля с активным состоянием в акцентном цвете
function Chip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        background: active ? "rgba(212,175,55,0.15)" : "rgba(255,255,255,0.04)",
        color: active ? "#e8c860" : "#9b9ca4",
        border: `1px solid ${active ? "rgba(212,175,55,0.30)" : "rgba(255,255,255,0.06)"}`,
        transition: "all 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        fontFamily: "inherit",
      }}
    >{label}</button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TOAST — уведомления с иконкой и пружинистой анимацией появления
// ────────────────────────────────────────────────────────────────────────────
function Toast({ visible, text, type = "success" }) {
  const config = {
    success: { color: "#6ee7a8", bg: "rgba(110,231,168,0.12)", border: "rgba(110,231,168,0.30)", Icon: CheckCircle2 },
    error:   { color: "#f8a3a3", bg: "rgba(248,163,163,0.12)",  border: "rgba(248,163,163,0.30)",  Icon: CircleAlert },
    info:    { color: "#d4af37", bg: "rgba(212,175,55,0.12)", border: "rgba(212,175,55,0.30)", Icon: Sparkles },
  };
  const { color, bg, border, Icon } = config[type] || config.success;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 200,
            background: "#1c1c1a",
            border: `1px solid ${border}`,
            color: "#f7f8f8",
            borderRadius: 12,
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
            display: "flex", alignItems: "center", gap: 10,
            maxWidth: "calc(100vw - 48px)",
            backdropFilter: "blur(8px)",
          }}
        >
          <span style={{ background: bg, padding: 4, borderRadius: 6, display: "flex", color }}>
            <Icon size={14} strokeWidth={2.4} />
          </span>
          <span>{text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MODAL — модальное окно с анимацией масштабирования и затемнением фона
// ────────────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, maxWidth = 480, icon }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{
          position: "fixed", inset: 0, zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16,
          background: "rgba(8,9,15,0.80)",
          backdropFilter: "blur(8px)",
        }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 4 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "#1c1c1a",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 18,
            width: "100%",
            maxWidth: `min(100vw - 32px, ${maxWidth}px)`,
            maxHeight: "90vh",
            overflowY: "auto",
            boxShadow: "0 24px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "16px 22px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {icon && <span style={{ color: "#e8c860", display: "flex" }}>{icon}</span>}
              <h3 style={{
                color: "#f7f8f8", fontWeight: 600, fontSize: 15, margin: 0,
                letterSpacing: "-0.01em",
              }}>{title}</h3>
            </div>
            <button
              onClick={onClose}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#9b9ca4",
                width: 30, height: 30,
                borderRadius: 8,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.18s",
              }}
              onMouseOver={(e) => { e.currentTarget.style.color = "#f7f8f8"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseOut={(e) => { e.currentTarget.style.color = "#9b9ca4"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            >
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
          <div style={{ padding: "20px 22px" }}>{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// KPI CARD — главная карточка показателя с эффектом стекла и анимацией числа
// ────────────────────────────────────────────────────────────────────────────
// Это самые важные элементы дашборда — четыре главные цифры на верху страницы.
// Поэтому они получают полную визуальную обработку: эффект стекла с лёгким
// размытием, мягкое свечение акцентным цветом по краю, иконка в подсвеченном
// квадрате слева, и плавная анимация числа при первом появлении.
function KpiCard({ label, value, sub, color = "#d4af37", Icon, format, trend }) {
  // Определяем формат отображения значения. Если передана функция format,
  // используем её. Если значение строка (например, "65%") — оставляем как есть.
  // Иначе округляем число до целого.
  const isString = typeof value === "string";

  return (
    <div className="glass-card" style={{ borderRadius: 14, padding: 16, position: "relative", overflow: "hidden" }}>
      {/* Тонкое цветное свечение в углу — акцент в цвет показателя */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30, right: -30,
          width: 90, height: 90,
          background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Label>{label}</Label>
          <div style={{
            fontSize: 18, fontWeight: 700,
            color: "#f7f8f8",
            marginTop: 6,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            fontVariantNumeric: "tabular-nums",
          }}>
            {isString ? value : (
              format ? <AnimatedNumber value={value} format={format}/> : <AnimatedNumber value={value}/>
            )}
          </div>
          {sub && (
            <div style={{
              fontSize: 11, color: "#62646b", marginTop: 6,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {trend === "up" && <TrendingUp size={11} style={{ color: "#6ee7a8" }}/>}
              {trend === "down" && <TrendingDown size={11} style={{ color: "#f8a3a3" }}/>}
              <span>{sub}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div style={{
            background: `${color}1a`,
            border: `1px solid ${color}33`,
            padding: 8,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color,
            flexShrink: 0,
          }}>
            <Icon size={16} strokeWidth={2} />
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN — экран входа и регистрации
// ════════════════════════════════════════════════════════════════════════════
// Показывается до того как пользователь авторизовался. После входа
// проверяется флаг profile.approved — если false, выкидываем обратно сюда
// с соответствующим сообщением.
function AuthScreen({ onAuthenticated, onError }) {
  const [mode, setMode] = useState("signin");        // signin | signup | check_email
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Заполни email и пароль");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const client = supabase;
      if (mode === "signin") {
        const { user, session } = await signInWithPassword(client, email.trim(), password);
        if (!user || !session) throw new Error("Не удалось получить сессию");
        // Проверяем профиль и одобрение
        const profile = await fetchProfile(client, user.id);
        if (!profile.approved) {
          await signOut(client);
          throw new Error("Аккаунт ожидает одобрения администратором");
        }
        onAuthenticated(user, profile);
      } else {
        // Регистрация: autoconfirm включён (письма нет) — аккаунт создаётся и ждёт одобрения админом
        await signUpWithPassword(client, email.trim(), password);
        setMode("check_email");
      }
    } catch (e) {
      setError(translateAuthError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#f7f8f8",
      fontFamily: "'Geist Variable', system-ui, -apple-system, sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Декоративный градиентный фон с эффектом размытия в углах */}
      <div aria-hidden style={{
        position: "absolute",
        top: -100, left: -100,
        width: 380, height: 380,
        background: "radial-gradient(circle, rgba(212,175,55,0.18) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div aria-hidden style={{
        position: "absolute",
        bottom: -100, right: -100,
        width: 380, height: 380,
        background: "radial-gradient(circle, rgba(212,175,55,0.10) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ width: "100%", maxWidth: 380, position: "relative" }}
      >
        {/* Лого и подзаголовок */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            marginBottom: 8,
            background: "linear-gradient(135deg, #d4af37 0%, #e8c860 50%, #d4af37 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>КЛИМАТ-ПРО</div>
          <div style={{
            fontSize: 11,
            color: "#62646b",
            fontWeight: 500,
            opacity: 0.6,
            marginBottom: 6,
          }}>
            Проектирование систем ОВиК<br/>Нам важно чем вы дышите.
          </div>
          <div style={{
            fontSize: 11,
            color: "#62646b",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontWeight: 500,
          }}>
            Искусство климата, инженерия комфорта
          </div>
        </div>

        <div className="glass-card" style={{ borderRadius: 16, padding: 24 }}>
          {mode === "check_email" ? (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <div style={{
                width: 56, height: 56,
                borderRadius: 14,
                background: "rgba(212,175,55,0.15)",
                border: "1px solid rgba(212,175,55,0.30)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                color: "#e8c860",
              }}>
                <Hourglass size={28} strokeWidth={1.8} />
              </div>
              <div style={{
                fontSize: 17,
                fontWeight: 600,
                color: "#f7f8f8",
                marginBottom: 8,
                letterSpacing: "-0.02em",
              }}>
                Заявка отправлена
              </div>
              <p style={{ fontSize: 13, color: "#9b9ca4", marginBottom: 20, lineHeight: 1.55 }}>
                Аккаунт <span style={{ color: "#e8c860", fontWeight: 500 }}>{email}</span> создан
                и ожидает одобрения администратором. После одобрения вы сможете войти.
              </p>
              <button
                onClick={() => { setMode("signin"); setError(null); }}
                className={BTN.primary}
                style={{ width: "100%" }}
              >
                Назад ко входу
              </button>
            </div>
          ) : (
            <>
              <div style={{
                fontSize: 16,
                fontWeight: 600,
                color: "#f7f8f8",
                marginBottom: 18,
                letterSpacing: "-0.01em",
              }}>
                {mode === "signin" ? "Вход в систему" : "Регистрация"}
              </div>

              <Field label="Email">
                <StyledInput
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>

              <Field label="Пароль">
                <StyledInput
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                  onKeyDown={e => { if (e.key === "Enter") submit(); }}
                />
              </Field>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    background: "rgba(248,163,163,0.10)",
                    border: "1px solid rgba(248,163,163,0.30)",
                    color: "#f8a3a3",
                    padding: "9px 12px",
                    borderRadius: 8,
                    fontSize: 12,
                    marginBottom: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <CircleAlert size={14} strokeWidth={2.2} />
                  <span>{error}</span>
                </motion.div>
              )}

              <button
                onClick={submit}
                disabled={loading}
                className={BTN.primary}
                style={{
                  width: "100%",
                  opacity: loading ? 0.7 : 1,
                  marginBottom: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "10px 16px",
                }}
              >
                {loading
                  ? <><Loader2 size={14} className="animate-spin" strokeWidth={2.4} /> Подключаемся...</>
                  : (mode === "signin" ? "Войти" : "Зарегистрироваться")}
              </button>

              <div style={{ textAlign: "center", fontSize: 12, color: "#62646b" }}>
                {mode === "signin" ? (
                  <>Нет аккаунта?{" "}
                    <button
                      onClick={() => { setMode("signup"); setError(null); }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#e8c860",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 500,
                        padding: 0,
                        fontFamily: "inherit",
                      }}
                    >Зарегистрироваться</button>
                  </>
                ) : (
                  <>Уже есть аккаунт?{" "}
                    <button
                      onClick={() => { setMode("signin"); setError(null); }}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#e8c860",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 500,
                        padding: 0,
                        fontFamily: "inherit",
                      }}
                    >Войти</button>
                  </>
                )}
              </div>
              {mode === "signin" && (
                <div style={{ textAlign: "center", fontSize: 11, color: "#62646b", marginTop: 10 }}>
                  Забыли пароль? Обратитесь к администратору
                </div>
              )}
            </>
          )}
        </div>

        <p style={{
          textAlign: "center",
          fontSize: 10,
          color: "#3a3c44",
          marginTop: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}>
          <Cloud size={11} strokeWidth={2.2} />
          Данные хранятся в защищённой БД Supabase (Frankfurt)
        </p>
      </motion.div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECT FORM
// ════════════════════════════════════════════════════════════════════════════
function ProjectForm({ initial, onSave, onClose, saving, client, profile, showToast, isOwner }) {
  const [f, setF] = useState(initial || {
    name: "", client: "", executor: "", type: "ОВиК", stage: "Переговоры",
    startDate: todayStr(), deadline: "", contractSum: "", paidAmount: "", notes: "",
    visibility: "private",
    // v1.2 поля
    links: [],
    clientPhone: "", clientEmail: "", clientTelegram: "",
    // v1.5 поля
    clientId: null,
    // v2.0 поля
    visibilityUsers: [], // для режима selected: [{id, email, name}]
    executorUserId: null, // UUID исполнителя для Telegram-уведомления
  });
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));

  // v2.0: состояние поиска пользователей для режима selected
  const [visUserQuery, setVisUserQuery] = useState("");
  const [visUserResults, setVisUserResults] = useState([]);

  // Загружаем список visibilityUsers при открытии формы редактирования
  useEffect(() => {
    if (initial?.id && initial?.visibility === "selected" && client) {
      getProjectVisibilityUsers(client, initial.id).then(users => {
        setF(p => ({ ...p, visibilityUsers: users }));
      }).catch(() => {});
    }
  }, [initial?.id, initial?.visibility]); // eslint-disable-line

  // Поиск пользователей для selected-списка
  useEffect(() => {
    if (f.visibility !== "selected" || !client) return;
    if (!visUserQuery.trim()) { setVisUserResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchApprovedUsers(client, visUserQuery);
      const addedIds = new Set((f.visibilityUsers || []).map(u => u.id));
      setVisUserResults(res.filter(u => !addedIds.has(u.id)));
    }, 300);
    return () => clearTimeout(t);
  }, [visUserQuery, f.visibility, f.visibilityUsers]); // eslint-disable-line

  const addVisUser = (user) => {
    setF(p => ({ ...p, visibilityUsers: [...(p.visibilityUsers || []), user] }));
    setVisUserQuery("");
    setVisUserResults([]);
  };
  const removeVisUser = (id) => {
    setF(p => ({ ...p, visibilityUsers: (p.visibilityUsers || []).filter(u => u.id !== id) }));
  };

  // v2.0: поиск исполнителя по пользователям системы
  const [execQuery, setExecQuery]     = useState("");
  const [execResults, setExecResults] = useState([]);

  useEffect(() => {
    if (!client || !execQuery.trim()) { setExecResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchApprovedUsers(client, execQuery);
      setExecResults(res);
    }, 300);
    return () => clearTimeout(t);
  }, [execQuery]); // eslint-disable-line

  const selectExecUser = (user) => {
    setF(p => ({ ...p, executor: user.name || user.email, executorUserId: user.id }));
    setExecQuery("");
    setExecResults([]);
  };
  // редактирование отдельных полей конкретной записи
  const addLink = () => {
    setF(p => ({ ...p, links: [...(p.links || []), { title: "", url: "" }] }));
  };
  const removeLink = (idx) => {
    setF(p => ({ ...p, links: (p.links || []).filter((_, i) => i !== idx) }));
  };
  const updateLink = (idx, key, value) => {
    setF(p => ({
      ...p,
      links: (p.links || []).map((l, i) => i === idx ? { ...l, [key]: value } : l),
    }));
  };

  return (
    <div>
      <Field label="Название проекта">
        <StyledInput value={f.name} onChange={e => s("name", e.target.value)}
          placeholder="Н-р: ОВиК Жилой дом пер. Строителей" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <Label>Заказчик / Клиент</Label>
          {client ? (
            <ClientSelector
              value={f.client}
              clientId={f.clientId}
              onSelect={(v) => s("client", v)}
              onClear={() => s("clientId", null)}
              client={client}
              onClientPicked={(picked) => {
                // При выборе клиента из базы автозаполняем контакты
                setF(p => ({
                  ...p,
                  client: picked.name,
                  clientId: picked.id,
                  clientPhone: picked.phone || p.clientPhone,
                  clientEmail: picked.email || p.clientEmail,
                  clientTelegram: picked.telegram || p.clientTelegram,
                }));
              }}
            />
          ) : (
            <StyledInput value={f.client} onChange={e => s("client", e.target.value)} />
          )}
        </div>
        <div style={{ position: "relative" }}><Label>Исполнитель</Label>
          <StyledInput value={f.executor}
            onChange={e => { s("executor", e.target.value); s("executorUserId", null); setExecQuery(e.target.value); }}
            onBlur={() => setTimeout(() => setExecResults([]), 200)}
            placeholder="Н-р: Субподряд" />
          {execResults.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
              background: "#1c1c1a", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8, overflow: "hidden", marginTop: 2,
            }}>
              {execResults.map(u => (
                <div key={u.id}
                  onMouseDown={() => selectExecUser(u)}
                  style={{
                    padding: "8px 12px", cursor: "pointer", fontSize: 12,
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                  onMouseOver={e => e.currentTarget.style.background = "rgba(212,175,55,0.10)"}
                  onMouseOut={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ color: "#fafaf7" }}>{u.name || u.email}</span>
                  {u.name && <span style={{ color: "#6b6b67" }}>{u.email}</span>}
                  <Send size={10} strokeWidth={2} style={{ marginLeft: "auto", color: "#d4af37", flexShrink: 0 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <Label>Тип работ</Label>
          <StyledSelect value={f.type} onChange={e => s("type", e.target.value)}>
            {PROJECT_TYPES.map(t => <option key={t}>{t}</option>)}
          </StyledSelect>
        </div>
        <div>
          <Label>Стадия</Label>
          <StyledSelect value={f.stage} onChange={e => s("stage", e.target.value)}>
            {PROJECT_STAGES.map(t => <option key={t}>{t}</option>)}
          </StyledSelect>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><Label>Дата начала</Label>
          <StyledInput type="date" value={f.startDate} onChange={e => s("startDate", e.target.value)} /></div>
        <div><Label>Дедлайн</Label>
          <StyledInput type="date" value={f.deadline} onChange={e => s("deadline", e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><Label>Сумма договора (₽)</Label>
          <StyledInput type="number" value={f.contractSum} onChange={e => s("contractSum", e.target.value)} placeholder="0" /></div>
        <div><Label>Оплачено факт (₽)</Label>
          <StyledInput type="number" value={f.paidAmount} onChange={e => s("paidAmount", e.target.value)} placeholder="0" /></div>
      </div>

      {/* ═══ НОВАЯ СЕКЦИЯ: Контакты заказчика ═══ */}
      <div style={{
        marginTop: 18, marginBottom: 14,
        padding: "12px 14px",
        background: "rgba(212,175,55,0.04)",
        border: "1px solid rgba(212,175,55,0.12)",
        borderRadius: 10,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 600, color: "#d4af37",
          textTransform: "uppercase", letterSpacing: "0.10em",
          marginBottom: 12,
        }}>
          <User size={12} strokeWidth={2.4} />
          Контакты заказчика
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <Label>Телефон</Label>
            <StyledInput
              type="tel"
              value={f.clientPhone}
              onChange={e => s("clientPhone", e.target.value)}
              placeholder="+7 999 123-45-67"
            />
          </div>
          <div>
            <Label>Email</Label>
            <StyledInput
              type="email"
              value={f.clientEmail}
              onChange={e => s("clientEmail", e.target.value)}
              placeholder="client@example.com"
            />
          </div>
        </div>
        <div>
          <Label>Telegram (без @)</Label>
          <StyledInput
            value={f.clientTelegram}
            onChange={e => s("clientTelegram", e.target.value)}
            placeholder="username"
          />
        </div>
      </div>

      {/* ═══ НОВАЯ СЕКЦИЯ: Ссылки на материалы ═══ */}
      <div style={{
        marginBottom: 14,
        padding: "12px 14px",
        background: "rgba(212,175,55,0.04)",
        border: "1px solid rgba(212,175,55,0.12)",
        borderRadius: 10,
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 10,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, fontWeight: 600, color: "#d4af37",
            textTransform: "uppercase", letterSpacing: "0.10em",
          }}>
            <FolderInput size={12} strokeWidth={2.4} />
            Ссылки на материалы
          </div>
          <button
            type="button"
            onClick={addLink}
            style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontWeight: 500,
              background: "rgba(212,175,55,0.12)",
              border: "1px solid rgba(212,175,55,0.30)",
              color: "#d4af37",
              display: "flex", alignItems: "center", gap: 4,
              fontFamily: "inherit",
            }}
          >
            <Plus size={11} strokeWidth={2.4} /> Добавить
          </button>
        </div>
        {(f.links || []).length === 0 ? (
          <div style={{
            fontSize: 11, color: "#6b6b67", textAlign: "center",
            padding: "10px 0", fontStyle: "italic",
          }}>
            Yandex Disk, Google Drive, чертежи в облаке, переписки в Telegram...
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(f.links || []).map((link, idx) => (
              <div
                key={idx}
                style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 28px", gap: 6, alignItems: "center" }}
              >
                <StyledInput
                  value={link.title || ""}
                  onChange={e => updateLink(idx, "title", e.target.value)}
                  placeholder="Подпись"
                  style={{ fontSize: 12, padding: "6px 10px" }}
                />
                <StyledInput
                  value={link.url || ""}
                  onChange={e => updateLink(idx, "url", e.target.value)}
                  placeholder="https://..."
                  style={{ fontSize: 12, padding: "6px 10px" }}
                />
                <button
                  type="button"
                  onClick={() => removeLink(idx)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#6b6b67",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "color 0.18s",
                  }}
                  onMouseOver={e => e.currentTarget.style.color = "#f8a3a3"}
                  onMouseOut={e => e.currentTarget.style.color = "#6b6b67"}
                  title="Удалить ссылку"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Field label="Видимость">
        <StyledSelect value={f.visibility} onChange={e => s("visibility", e.target.value)}>
          <option value="private">Личный (только я)</option>
          <option value="team">Командный (видят все одобренные)</option>
          <option value="selected">Избранные (только выбранные пользователи)</option>
          <option value="marketplace">Маркетплейс (ищу исполнителя)</option>
        </StyledSelect>
      </Field>

      {/* ── Баннер маркетплейса ─────────────────────────────────────────── */}
      {f.visibility === "marketplace" && (
        <div style={{
          marginBottom: 14, padding: "10px 14px",
          background: "rgba(147,197,253,0.06)",
          border: "1px solid rgba(147,197,253,0.20)",
          borderRadius: 10,
          fontSize: 12, color: "#93c5fd", lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Store size={13} strokeWidth={2.2} />
            Проект попадёт в маркетплейс
          </div>
          Стадия проекта должна быть «Поиск исполнителя». Любой одобренный пользователь системы
          сможет увидеть проект и нажать «Взять в работу». После взятия проект уйдёт из маркетплейса.
        </div>
      )}

      {/* ── Пикер пользователей для режима selected ─────────────────────── */}
      {f.visibility === "selected" && (
        <div style={{
          marginBottom: 14, padding: "12px 14px",
          background: "rgba(212,175,55,0.04)",
          border: "1px solid rgba(212,175,55,0.12)",
          borderRadius: 10,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "#d4af37",
            textTransform: "uppercase", letterSpacing: "0.10em",
            marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
          }}>
            <Eye size={12} strokeWidth={2.4} />
            Кому показать проект
          </div>

          {/* Поиск пользователя */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <StyledInput
              value={visUserQuery}
              onChange={e => setVisUserQuery(e.target.value)}
              onBlur={() => setTimeout(() => setVisUserResults([]), 200)}
              placeholder="Поиск по email или имени…"
            />
            {visUserResults.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                background: "#1c1c1a", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8, overflow: "hidden", marginTop: 2,
              }}>
                {visUserResults.map(u => (
                  <div key={u.id}
                    onClick={() => addVisUser(u)}
                    style={{
                      padding: "8px 12px", cursor: "pointer", fontSize: 12,
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      transition: "background 0.12s",
                    }}
                    onMouseOver={e => e.currentTarget.style.background = "rgba(212,175,55,0.10)"}
                    onMouseOut={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ color: "#fafaf7" }}>{u.name || u.email}</span>
                    {u.name && <span style={{ color: "#6b6b67", marginLeft: 8 }}>{u.email}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Список добавленных */}
          {(f.visibilityUsers || []).length === 0
            ? <p style={{ fontSize: 11, color: "#6b6b67", margin: 0 }}>Никто не добавлен — проект будет виден только вам</p>
            : (f.visibilityUsers || []).map(u => (
              <div key={u.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "5px 10px", marginBottom: 4,
                background: "rgba(255,255,255,0.03)", borderRadius: 6,
              }}>
                <span style={{ fontSize: 12, color: "#fafaf7" }}>{u.name || u.email}</span>
                <button onClick={() => removeVisUser(u.id)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#f8a3a3", padding: 2, lineHeight: 1,
                }}>
                  <X size={12} />
                </button>
              </div>
            ))
          }
        </div>
      )}

      {/* ═══ СЕКЦИЯ: Команда проекта (v1.5) ═══ */}
      {initial && initial.id && client && (
        <div style={{
          marginBottom: 14, padding: "12px 14px",
          background: "rgba(212,175,55,0.04)",
          border: "1px solid rgba(212,175,55,0.12)",
          borderRadius: 10,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, fontWeight: 600, color: "#d4af37",
            textTransform: "uppercase", letterSpacing: "0.10em",
            marginBottom: 12,
          }}>
            <Users size={12} strokeWidth={2.4} />
            Команда проекта
          </div>
          <MembersManager
            projectId={initial.id}
            profile={profile}
            client={client}
            showToast={showToast}
            canManage={isOwner || profile?.role === "admin"}
          />
        </div>
      )}

      {/* ═══ СЕКЦИЯ: Комментарии (v2.0) ═══ */}
      {initial && initial.id && client && (
        <div style={{
          marginBottom: 14, padding: "12px 14px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 10,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, fontWeight: 600, color: "#a8a8a3",
            textTransform: "uppercase", letterSpacing: "0.10em",
            marginBottom: 12,
          }}>
            <MessageSquare size={12} strokeWidth={2.4} />
            Комментарии
          </div>
          <CommentsSection
            projectId={initial.id}
            profile={profile}
            client={client}
            showToast={showToast}
            isOwner={isOwner}
          />
        </div>
      )}

      {/* ═══ СЕКЦИЯ: Файлы на Yandex Disk (v2.0) ═══ */}
      {initial && initial.id && client && (
        <div style={{
          marginBottom: 14, padding: "12px 14px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 10,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, fontWeight: 600, color: "#a8a8a3",
            textTransform: "uppercase", letterSpacing: "0.10em",
            marginBottom: 12,
          }}>
            <HardDrive size={12} strokeWidth={2.4} />
            Файлы проекта
          </div>
          <ProjectFiles
            projectId={initial.id}
            profile={profile}
            client={client}
            showToast={showToast}
            isOwner={isOwner}
          />
          {initial.id && <ProjectTasksSection projectId={initial.id} client={client} profile={profile} showToast={showToast} />}
        </div>
      )}

      <Field label="Примечания">
        <StyledTextarea rows={2} value={f.notes} onChange={e => s("notes", e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button onClick={onClose} className={BTN.ghost} style={{ flex: 1 }} disabled={saving}>Отмена</button>
        <button onClick={() => onSave(f)} className={BTN.primary} style={{ flex: 2, opacity: saving ? 0.6 : 1 }} disabled={saving}>
          {saving ? "Сохраняем..." : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TRANSACTION FORM
// ════════════════════════════════════════════════════════════════════════════
function TxForm({ initial, onSave, onClose, saving }) {
  const [f, setF] = useState(initial || {
    date:todayStr(),type:"income",category:"Проектирование",amount:"",description:""
  });
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  const cats = f.type==="income" ? INCOME_CATS : EXPENSE_CATS;

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><Label>Дата</Label>
          <StyledInput type="date" value={f.date} onChange={e=>s("date",e.target.value)}/></div>
        <div><Label>Тип</Label>
          <StyledSelect value={f.type} onChange={e=>{
            const v=e.target.value; s("type",v);
            s("category",v==="income"?INCOME_CATS[0]:EXPENSE_CATS[0]);
          }}>
            <option value="income">Доход</option>
            <option value="expense">Расход</option>
          </StyledSelect>
        </div>
      </div>
      <Field label="Категория">
        <StyledSelect value={f.category} onChange={e=>s("category",e.target.value)}>
          {cats.map(c=><option key={c}>{c}</option>)}
        </StyledSelect>
      </Field>
      <Field label="Сумма (₽)">
        <StyledInput type="number" value={f.amount} onChange={e=>s("amount",e.target.value)} placeholder="0"/>
      </Field>
      <Field label="Описание / комментарий">
        <StyledInput value={f.description} onChange={e=>s("description",e.target.value)}/>
      </Field>
      <div style={{display:"flex",gap:10,marginTop:4}}>
        <button onClick={onClose} className={BTN.ghost} style={{flex:1}} disabled={saving}>Отмена</button>
        <button onClick={()=>onSave(f)} className={BTN.primary} style={{flex:2,opacity:saving?0.6:1}} disabled={saving}>
          {saving?"Сохраняем...":"Сохранить"}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD — главная страница с KPI и графиками
// ════════════════════════════════════════════════════════════════════════════
function Dashboard({ projects, txs }) {
  const active = projects.filter(p => !["Оплачен", "Архив"].includes(p.stage));
  const portfolio = projects.filter(p => p.stage !== "Архив");
  const totalContract = portfolio.reduce((s, p) => s + (+p.contractSum || 0), 0);
  const totalPaid = portfolio.reduce((s, p) => s + (+p.paidAmount || 0), 0);

  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mTxs = txs.filter(t => t.date.startsWith(mk));
  const mIncome = mTxs.filter(t => t.type === "income").reduce((s, t) => s + (+t.amount || 0), 0);
  const mExpense = mTxs.filter(t => t.type === "expense").reduce((s, t) => s + (+t.amount || 0), 0);

  // Сравнение с прошлым месяцем для индикатора тренда
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMk = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const prevTxs = txs.filter(t => t.date.startsWith(prevMk));
  const prevIncome = prevTxs.filter(t => t.type === "income").reduce((s, t) => s + (+t.amount || 0), 0);
  const prevExpense = prevTxs.filter(t => t.type === "expense").reduce((s, t) => s + (+t.amount || 0), 0);
  const prevBalance = prevIncome - prevExpense;
  const curBalance = mIncome - mExpense;
  const balanceTrend = prevBalance === 0 ? null : (curBalance > prevBalance ? "up" : "down");

  const stageData = PROJECT_STAGES.slice(0, -1)
    .map(s => ({ name: s, value: projects.filter(p => p.stage === s).length, fill: STAGE_META[s].color }))
    .filter(d => d.value > 0);

  const months6 = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const inc = txs.filter(t => t.type === "income" && t.date.startsWith(k)).reduce((s, t) => s + (+t.amount || 0), 0);
    const exp = txs.filter(t => t.type === "expense" && t.date.startsWith(k)).reduce((s, t) => s + (+t.amount || 0), 0);
    return { label: d.toLocaleDateString("ru-RU", { month: "short" }), inc, exp };
  });

  const todayS = todayStr();
  const overdue = active.filter(p => p.deadline && p.deadline < todayS && p.stage !== "Сдан заказчику");
  const upcoming = active.filter(p => p.deadline && p.deadline >= todayS)
    .sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 4);

  // Тёмная стилизация для всплывающих подсказок графиков
  const tt = {
    background: "#1c1c1a",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    fontSize: 12,
    color: "#f7f8f8",
    boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
    padding: "8px 12px",
  };

  // Каскадная анимация появления — каждый элемент появляется со своей задержкой
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  };

  return (
    <motion.div
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Главные KPI — четыре стеклянные карточки */}
      <motion.div variants={itemVariants} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <KpiCard
          label="Активных проектов"
          value={active.length}
          Icon={FolderKanban}
          color="#d4af37"
          sub={`всего: ${projects.length}`}
        />
        <KpiCard
          label="Портфель"
          value={totalContract}
          Icon={Briefcase}
          color="#d4af37"
          format={fmt}
        />
        <KpiCard
          label="Получено"
          value={totalPaid}
          Icon={BadgeCheck}
          color="#6ee7a8"
          format={fmt}
          sub={`осталось: ${fmt(totalContract - totalPaid)}`}
        />
        <KpiCard
          label="Баланс месяца"
          value={curBalance}
          Icon={Wallet}
          color={curBalance >= 0 ? "#6ee7a8" : "#f8a3a3"}
          format={fmt}
          sub={`доходы ${fmt(mIncome)}`}
          trend={balanceTrend}
        />
      </motion.div>

      {/* Два графика рядом */}
      <motion.div variants={itemVariants} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <Card>
          <SectionTitle icon={<BarChart3 size={13} />}>Проекты по стадиям</SectionTitle>
          {stageData.length > 0
            ? <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie data={stageData} cx="50%" cy="50%" innerRadius={56} outerRadius={84} dataKey="value" paddingAngle={3}>
                  {stageData.map((e, i) => <Cell key={i} fill={e.fill} stroke="transparent" />)}
                </Pie>
                <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v, n) => [`${v} проектов`, n]} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={v => <span style={{ fontSize: 10, color: "#9b9ca4" }}>{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
            : <Empty text="Добавь первый проект" />}
        </Card>
        <Card>
          <SectionTitle icon={<TrendingUp size={13} />}>Доходы и расходы — 6 мес.</SectionTitle>
          {months6.some(m => m.inc > 0 || m.exp > 0)
            ? <ResponsiveContainer width="100%" height={210}>
              <BarChart data={months6} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#62646b", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#62646b", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}к` : v} />
                <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v, n) => [fmt(v), n === "inc" ? "Доходы" : "Расходы"]} />
                <Bar dataKey="inc" name="inc" fill="#d4af37" radius={[5, 5, 0, 0]} />
                <Bar dataKey="exp" name="exp" fill="#f8a3a3" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            : <Empty text="Добавь первые финансовые записи" />}
        </Card>
      </motion.div>

      {/* Дедлайны: просроченные и предстоящие */}
      <motion.div variants={itemVariants} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <Card>
          <SectionTitle icon={<AlertTriangle size={13} />}>Просроченные дедлайны</SectionTitle>
          {overdue.length === 0
            ? <p style={{ color: "#62646b", fontSize: 13, margin: 0 }}>Всё в срок</p>
            : overdue.map(p => (
              <div key={p.id} style={{
                display: "flex", justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{
                  color: "#f8a3a3", fontSize: 13, fontWeight: 500, flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{p.name}</span>
                <span style={{ color: "#62646b", fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{fmtD(p.deadline)}</span>
              </div>
            ))}
        </Card>
        <Card>
          <SectionTitle icon={<Calendar size={13} />}>Ближайшие дедлайны</SectionTitle>
          {upcoming.length === 0
            ? <p style={{ color: "#62646b", fontSize: 13, margin: 0 }}>Нет запланированных дедлайнов</p>
            : upcoming.map(p => (
              <div key={p.id} style={{
                display: "flex", justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{
                  color: "#f7f8f8", fontSize: 13, flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{p.name}</span>
                <span style={{ color: "#e8c860", fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{fmtD(p.deadline)}</span>
              </div>
            ))}
        </Card>
      </motion.div>

      {/* Финансы текущего месяца с прогресс-баром */}
      <motion.div variants={itemVariants}>
        <Card>
          <SectionTitle icon={<Wallet size={13} />}>Финансы текущего месяца</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16 }}>
            {[
              { label: "Доходы", val: mIncome, color: "#e8c860" },
              { label: "Расходы", val: mExpense, color: "#f8a3a3" },
              { label: "Баланс", val: curBalance, color: curBalance >= 0 ? "#6ee7a8" : "#f8a3a3" },
            ].map(r => (
              <div key={r.label}>
                <Label>{r.label}</Label>
                <div style={{
                  fontSize: 18, fontWeight: 700,
                  color: r.color, marginTop: 6,
                  letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums",
                }}>{fmt(r.val)}</div>
              </div>
            ))}
          </div>
          {mIncome > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 11, color: "#62646b", marginBottom: 6,
              }}>
                <span>Расходы от доходов</span>
                <span>{Math.min(100, Math.round(mExpense / mIncome * 100))}%</span>
              </div>
              <div style={{
                height: 6, background: "rgba(255,255,255,0.06)",
                borderRadius: 3, overflow: "hidden",
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, mExpense / mIncome * 100)}%` }}
                  transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                  style={{
                    height: "100%",
                    background: "linear-gradient(90deg, #d4af37, #e8c860)",
                    borderRadius: 3,
                  }}
                />
              </div>
            </div>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECTS — список + CRUD через Supabase
// ════════════════════════════════════════════════════════════════════════════
function Projects({ projects, setProjects, clients, client, profile, ownerId, showToast }) {
  const [modal, setModal]             = useState(null);
  const [stageFilter, setStageFilter] = useState("Все");
  const [confirmDel, setConfirmDel]   = useState(null);
  const [saving, setSaving]           = useState(false);

  const saveProject = async (form) => {
    setSaving(true);
    try {
      let saved;
      if (modal === "add") {
        saved = await insertProject(client, form, ownerId);
        setProjects(prev => [saved, ...prev]);
        showToast("✓ Проект создан");
      } else {
        saved = await updateProject(client, modal.id, form, ownerId);
        setProjects(prev => prev.map(p => p.id === saved.id ? saved : p));
        showToast("✓ Проект обновлён");
      }
      // v2.0: сохраняем список видимости для режима selected
      if (form.visibility === "selected" && saved?.id) {
        const userIds = (form.visibilityUsers || []).map(u => u.id).filter(Boolean);
        await setProjectVisibilityUsers(client, saved.id, userIds);
      }
      // v2.0: уведомление исполнителю если он выбран из системы
      if (form.executorUserId) {
        const prevExecutorId = modal !== "add" ? modal?.executorUserId : null;
        if (form.executorUserId !== prevExecutorId) {
          sendPush(client, "team_invite", form.executorUserId, {
            projectName: saved?.name || form.name,
            actorName: profile?.name || profile?.email,
            customText: "Тебя назначили исполнителем проекта",
          });
        }
      }
      setModal(null);
    } catch (e) {
      showToast("Ошибка: " + (e.message || "не удалось сохранить"), "error");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    try {
      await deleteProjectDb(client, id);
      setProjects(prev => prev.filter(p=>p.id!==id));
      showToast("Проект удалён");
    } catch (e) {
      showToast("Ошибка удаления: " + (e.message || ""), "error");
    } finally {
      setConfirmDel(null);
    }
  };

  const visible = stageFilter === "Свободные"
    ? projects.filter(p => p.visibility === "marketplace" && !p.takenBy)
    : stageFilter === "Все"
      ? projects
      : projects.filter(p => p.stage === stageFilter);
  const todayS  = todayStr();

  return (
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20,alignItems:"center"}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,flex:1}}>
          {["Все","Свободные",...PROJECT_STAGES].map(s=>{
            const freeCount = projects.filter(p=>p.visibility==="marketplace"&&!p.takenBy).length;
            const cnt = s==="Все" ? projects.length : s==="Свободные" ? freeCount : projects.filter(p=>p.stage===s).length;
            return (
              <Chip key={s}
                label={`${s}${cnt>0?` (${cnt})`:""}`}
                active={stageFilter===s} onClick={()=>setStageFilter(s)}/>
            );
          })}
        </div>
        <button onClick={()=>setModal("add")} className={BTN.primary}>+ Новый проект</button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {visible.length===0
          ? <Empty text={stageFilter==="Свободные"?"Нет свободных проектов в маркетплейсе":stageFilter==="Все"?"Нет проектов — нажми «Новый проект»":`Нет проектов со стадией «${stageFilter}»`}/>
          : visible.map(p=>{
            const meta = STAGE_META[p.stage]||{color:"#d4af37",progress:0};
            const isAwaitingPayment = p.stage==="Сдан заказчику";
            const isOverdue = p.deadline&&p.deadline<todayS&&!["Оплачен","Архив","Сдан заказчику"].includes(p.stage);
            const paid = +p.paidAmount||0;
            const contract = +p.contractSum||0;
            return (
              <div key={p.id} style={{background:"#141414",border:"1px solid #141414",borderRadius:16,padding:16}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8,marginBottom:6}}>
                      <span style={{color:"white",fontWeight:700,fontSize:15}}>{p.name}</span>
                      <span style={{fontSize:11,padding:"2px 10px",borderRadius:20,fontWeight:600,
                        background:meta.color+"22",color:meta.color}}>{p.stage}</span>
                      <PermissionBadge role={
                        p.ownerId === profile?.id ? "owner"
                          : profile?.role === "admin" ? "admin"
                          : p.takenBy === profile?.id ? "editor"
                          : p.visibility === "team" ? "viewer"
                          : p.visibility === "marketplace" ? "marketplace"
                          : p.visibility === "selected" ? "selected"
                          : null
                      } />
                      {isAwaitingPayment&&<span style={{fontSize:11,color:"#d4af37",fontWeight:600}}>⏳ Ожидает оплаты</span>}
                      {isOverdue&&<span style={{fontSize:11,color:"#f8a3a3",fontWeight:600}}>⚠ Просрочен</span>}
                    </div>
                    <div style={{fontSize:13,color:"#a8a8a3",marginBottom:10,display:"flex",flexWrap:"wrap",alignItems:"center",gap:"2px 0"}}>
                      {p.client&&<span>{p.client}</span>}
                      {p.client&&p.type&&<span style={{margin:"0 6px",color:"#1c1c1a"}}>·</span>}
                      <span style={{color:"#e8c860",fontWeight:600}}>{p.type}</span>
                      {p.executor&&<><span style={{margin:"0 6px",color:"#1c1c1a"}}>·</span>
                      <span style={{color:"#d4af37"}}>👤 {p.executor}</span></>}
                    </div>
                    <div style={{height:4,background:"#141414",borderRadius:2,overflow:"hidden",marginBottom:10}}>
                      <div style={{height:"100%",borderRadius:2,background:meta.color,
                        width:`${meta.progress}%`,transition:"width 0.5s"}}/>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"4px 20px",fontSize:12}}>
                      {contract>0&&<span style={{color:"#a8a8a3"}}>Договор: <span style={{color:"#fafaf7",fontWeight:600}}>{fmt(contract)}</span></span>}
                      {paid>0&&<span style={{color:"#a8a8a3"}}>Оплачено: <span style={{color:"#6ee7a8",fontWeight:600}}>{fmt(paid)}</span></span>}
                      {contract>0&&paid>0&&<span style={{color:"#a8a8a3"}}>Остаток: <span style={{color:"#d4af37",fontWeight:600}}>{fmt(contract-paid)}</span></span>}
                      {p.deadline&&<span style={{color:"#a8a8a3"}}>Дедлайн: <span style={{color:isOverdue?"#f8a3a3":"#fafaf7",fontWeight:isOverdue?600:400}}>{fmtD(p.deadline)}</span></span>}
                    </div>
                    {contract>0&&paid>0&&(
                      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
                        <div style={{flex:1,height:3,background:"#141414",borderRadius:2,overflow:"hidden"}}>
                          <div style={{height:"100%",background:"#6ee7a8",borderRadius:2,
                            width:`${Math.min(100,paid/contract*100)}%`}}/>
                        </div>
                        <span style={{fontSize:10,color:"#6b6b67"}}>{Math.round(paid/contract*100)}%</span>
                      </div>
                    )}
                    {/* ═══ КОНТАКТЫ ЗАКАЗЧИКА ═══
                        Показываются как маленькие кликабельные иконки. Каждая
                        открывает соответствующее приложение через спец-протокол:
                        tel: для звонка, mailto: для письма, t.me для Telegram. */}
                    {(p.clientPhone || p.clientEmail || p.clientTelegram) && (
                      <div style={{
                        display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10,
                      }}>
                        {p.clientPhone && (
                          <a
                            href={`tel:${p.clientPhone.replace(/\s+/g, "")}`}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "4px 10px", borderRadius: 6,
                              background: "rgba(212,175,55,0.06)",
                              border: "1px solid rgba(212,175,55,0.20)",
                              color: "#d4af37",
                              fontSize: 11, fontWeight: 500,
                              textDecoration: "none",
                              transition: "all 0.18s",
                            }}
                            onClick={e => e.stopPropagation()}
                            onMouseOver={e => {
                              e.currentTarget.style.background = "rgba(212,175,55,0.12)";
                              e.currentTarget.style.color = "#e8c860";
                            }}
                            onMouseOut={e => {
                              e.currentTarget.style.background = "rgba(212,175,55,0.06)";
                              e.currentTarget.style.color = "#d4af37";
                            }}
                            title={`Позвонить ${p.clientPhone}`}
                          >
                            <Phone size={11} strokeWidth={2.2} />
                            {p.clientPhone}
                          </a>
                        )}
                        {p.clientEmail && (
                          <a
                            href={`mailto:${p.clientEmail}`}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "4px 10px", borderRadius: 6,
                              background: "rgba(212,175,55,0.06)",
                              border: "1px solid rgba(212,175,55,0.20)",
                              color: "#d4af37",
                              fontSize: 11, fontWeight: 500,
                              textDecoration: "none",
                              transition: "all 0.18s",
                            }}
                            onClick={e => e.stopPropagation()}
                            onMouseOver={e => {
                              e.currentTarget.style.background = "rgba(212,175,55,0.12)";
                              e.currentTarget.style.color = "#e8c860";
                            }}
                            onMouseOut={e => {
                              e.currentTarget.style.background = "rgba(212,175,55,0.06)";
                              e.currentTarget.style.color = "#d4af37";
                            }}
                            title={`Написать на ${p.clientEmail}`}
                          >
                            <Mail size={11} strokeWidth={2.2} />
                            {p.clientEmail}
                          </a>
                        )}
                        {p.clientTelegram && (
                          <a
                            href={`https://t.me/${p.clientTelegram.replace(/^@/, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "4px 10px", borderRadius: 6,
                              background: "rgba(212,175,55,0.06)",
                              border: "1px solid rgba(212,175,55,0.20)",
                              color: "#d4af37",
                              fontSize: 11, fontWeight: 500,
                              textDecoration: "none",
                              transition: "all 0.18s",
                            }}
                            onClick={e => e.stopPropagation()}
                            onMouseOver={e => {
                              e.currentTarget.style.background = "rgba(212,175,55,0.12)";
                              e.currentTarget.style.color = "#e8c860";
                            }}
                            onMouseOut={e => {
                              e.currentTarget.style.background = "rgba(212,175,55,0.06)";
                              e.currentTarget.style.color = "#d4af37";
                            }}
                            title={`Открыть Telegram @${p.clientTelegram}`}
                          >
                            <Send size={11} strokeWidth={2.2} />
                            @{p.clientTelegram.replace(/^@/, "")}
                          </a>
                        )}
                      </div>
                    )}
                    {/* ═══ ССЫЛКИ НА МАТЕРИАЛЫ ═══
                        Кликабельные кнопки с подписями, открываются в новой вкладке.
                        Иконка облака маркирует их как внешние ссылки. */}
                    {Array.isArray(p.links) && p.links.length > 0 && (
                      <div style={{
                        display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8,
                      }}>
                        {p.links.map((link, idx) => (
                          <a
                            key={idx}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              padding: "4px 10px", borderRadius: 6,
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.10)",
                              color: "#a8a8a3",
                              fontSize: 11, fontWeight: 500,
                              textDecoration: "none",
                              transition: "all 0.18s",
                              maxWidth: 240,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            onClick={e => e.stopPropagation()}
                            onMouseOver={e => {
                              e.currentTarget.style.background = "rgba(212,175,55,0.10)";
                              e.currentTarget.style.borderColor = "rgba(212,175,55,0.30)";
                              e.currentTarget.style.color = "#d4af37";
                            }}
                            onMouseOut={e => {
                              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                              e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
                              e.currentTarget.style.color = "#a8a8a3";
                            }}
                            title={link.url}
                          >
                            <ExternalLink size={11} strokeWidth={2.2} />
                            {link.title || "Ссылка"}
                          </a>
                        ))}
                      </div>
                    )}
                    {p.notes&&<p style={{margin:"10px 0 0",fontSize:11,color:"#6b6b67",fontStyle:"italic"}}>{p.notes}</p>}
                  </div>
                  {/* ═══ КНОПКИ ДЕЙСТВИЙ ═══ */}
                  <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,alignItems:"flex-end"}}>
                    {/* Владелец или admin: редактировать + удалить + маркетплейс */}
                    {(p.ownerId===profile?.id||profile?.role==="admin")&&(
                      <>
                        <button onClick={()=>setModal(p)} className={BTN.edit}>✏️</button>
                        <button onClick={()=>{if(confirmDel===p.id){del(p.id);}else{setConfirmDel(p.id);}}}
                          style={{
                            padding:"4px 8px",borderRadius:6,border:"none",cursor:"pointer",
                            fontSize:12,fontWeight:700,transition:"all .15s",
                            background:confirmDel===p.id?"#f8a3a333":"transparent",
                            color:confirmDel===p.id?"#f8a3a3":"#6b6b67",
                          }}
                          onBlur={()=>setConfirmDel(null)}
                          title={confirmDel===p.id?"Нажми ещё раз чтобы удалить":"Удалить проект"}
                        >{confirmDel===p.id?"✓?":"🗑️"}</button>
                        {p.visibility==="marketplace"&&p.takenBy&&(
                          <button
                            onClick={async()=>{
                              try{
                                await revokeProject(client,p.id);
                                setProjects(prev=>prev.map(x=>x.id===p.id?{...x,takenBy:null,stage:"Поиск исполнителя"}:x));
                                showToast("Проект возвращён в маркетплейс");
                                sendPush(client,"project_published",null,{ownerId:p.ownerId,initiatorId:p.ownerId,projectId:p.id});
                              }catch(e){showToast("Ошибка: "+(e.message||""),"error");}
                            }}
                            style={{
                              display:"flex",alignItems:"center",gap:4,
                              padding:"4px 8px",borderRadius:6,border:"1px solid rgba(248,163,163,0.30)",
                              background:"rgba(248,163,163,0.08)",color:"#f8a3a3",
                              fontSize:11,fontWeight:600,cursor:"pointer",transition:"all .15s",whiteSpace:"nowrap",
                            }}
                            title="Отозвать у исполнителя"
                          ><Undo2 size={11} strokeWidth={2.4}/>Отозвать</button>
                        )}
                      </>
                    )}
                    {/* Исполнитель (взял проект): кнопка «Вернуть» */}
                    {p.takenBy===profile?.id&&p.ownerId!==profile?.id&&(
                      <button
                        onClick={async()=>{
                          try{
                            await releaseProject(client,p.id);
                            setProjects(prev=>prev.map(x=>x.id===p.id?{...x,takenBy:null,stage:"Поиск исполнителя"}:x));
                            showToast("Проект возвращён в маркетплейс");
                            sendPush(client,"project_published",null,{ownerId:p.ownerId,initiatorId:p.ownerId,projectId:p.id});
                          }catch(e){showToast("Ошибка: "+(e.message||""),"error");}
                        }}
                        style={{
                          display:"flex",alignItems:"center",gap:4,
                          padding:"4px 10px",borderRadius:6,border:"1px solid rgba(243,215,123,0.30)",
                          background:"rgba(243,215,123,0.08)",color:"#f3d77b",
                          fontSize:11,fontWeight:600,cursor:"pointer",transition:"all .15s",whiteSpace:"nowrap",
                        }}
                        title="Вернуть в маркетплейс"
                      ><Undo2 size={11} strokeWidth={2.4}/>Вернуть</button>
                    )}
                    {/* Свободный маркетплейс-проект: кнопка «Взять» */}
                    {p.visibility==="marketplace"&&!p.takenBy&&p.ownerId!==profile?.id&&(
                      <button
                        onClick={async()=>{
                          try{
                            await takeProject(client,p.id);
                            // Обновляем executor в БД именем исполнителя
                            const executorName = profile?.name || profile?.email || "";
                            if (executorName) {
                              await client.from("projects").update({ executor: executorName }).eq("id", p.id);
                            }
                            setProjects(prev=>prev.map(x=>x.id===p.id?{...x,takenBy:profile?.id,stage:"В работе",executor:executorName}:x));
                            showToast("✓ Проект взят в работу");
                            // Уведомление владельцу проекта
                            sendPush(client,"project_taken",p.ownerId,{
                              projectName:p.name,
                              actorName:profile?.name||profile?.email,
                            });
                          }catch(e){showToast("Ошибка: "+(e.message||""),"error");}
                        }}
                        style={{
                          display:"flex",alignItems:"center",gap:5,
                          padding:"6px 12px",borderRadius:8,border:"1px solid rgba(110,231,168,0.35)",
                          background:"rgba(110,231,168,0.10)",color:"#6ee7a8",
                          fontSize:12,fontWeight:700,cursor:"pointer",transition:"all .15s",whiteSpace:"nowrap",
                        }}
                        onMouseOver={e=>{e.currentTarget.style.background="rgba(110,231,168,0.18)";}}
                        onMouseOut={e=>{e.currentTarget.style.background="rgba(110,231,168,0.10)";}}
                        title="Взять проект в работу"
                      ><UserCheck size={13} strokeWidth={2.4}/>Взять в работу</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {modal&&(
        <Modal title={modal==="add"?"Новый проект":"Редактировать проект"} onClose={()=>!saving&&setModal(null)}>
          <ProjectForm
            initial={modal === "add" ? null : modal}
            onSave={saveProject}
            onClose={() => setModal(null)}
            saving={saving}
            client={client}
            profile={profile}
            showToast={showToast}
            isOwner={modal === "add" || (modal && modal.ownerId === profile?.id)}
          />
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CSV / PDF IMPORT — автокатегоризация и парсеры банков (без изменений)
// ════════════════════════════════════════════════════════════════════════════
const CAT_RULES = [
  { cat:"Такси", keys:[
    "yandex*4121*taxi","yandex*4121*uber","yandex*4111*go_transpo",
    "yandex7299*go_berizar","yandex*7299*go_berizar",
    "яндекс го","yandex go","yango","uber","bolt","такси","taxi",
    "ситимобил","maxim","indrive","indriver","яндекс такси","yandex taxi",
  ]},
  { cat:"Транспорт", keys:[
    "mos.transport","mostransport","mos. transport",
    "yandex*4111*troyka","troyka","тройка","strelkacard","strelka",
    "cppk","цппк","centralnaya ppk","ao centralnaya ppk",
    "petrovsko-razumov","petrovskorazumovskaya",
    "aeroexpress","аэроэкспресс","rzd","ржд",
    "tutu.ru","tutu ru","tpp_st_avtolajn",
    "метро","metro","мцд","трамвай","троллейбус","мосгортранс","автобус",
  ]},
  { cat:"Кофе", keys:[
    "onepricecoffe","cofix","po kofeyku","po kofejku","sp_kofejnya",
    "kofejnya","kofein","kote kafe","street coffee","_kofejnya",
    "b1 maypo","coffeeshop",
  ]},
  { cat:"Питание", keys:[
    "vernyj 1300","vernyj","верный",
    "pyaterochka","пятёрочка","пятерочка",
    "magnit","магнит","perekrestok","перекрёсток","перекресток",
    "vkusvill","вкусвилл","dixy","дикси","spar","спар","lenta","лента",
    "auchan","ашан","окей","okej","глобус","globus",
    "krasnoe&beloe","krasnoe beloe","красное белое",
    "winelab","produkty","продукты","mikromarket",
    "yandex*5411*lavka","yandex*5814*eda","lavka","лавка",
    "delivery club","самокат","сбермаркет","азбука вкуса",
    "суши","sushi","пицца","pizza","burger","бургер","burger king",
    "mcdonalds","kfc","вкусно","dodo","додо","шоколадница","якитория",
    "subway","ebidoebi","doner market","шаурма","giro","girogiros",
    "qsr 29098","gastrokolledzh","mealty","столовая","ресторан","кафе",
    "pekarnya","evo_pekarnya","хлеб","пекарня","sunduk","tapper",
    "fix price","fixprice","spar 329","fix price 8090","fixprice 8090",
    "od verkhnie kotly","verkhnie kotly","rest june","микромаркет",
    "pizzasushiwok","donermkt",
  ]},
  { cat:"Здоровье / аптека", keys:[
    "gorzdrav","горздрав","36,6","36.6","aptechnoe","аптека","apteka",
    "rigla","ригла","pharmacy","antistress","ulybka radugi","улыбка радуги",
  ]},
  { cat:"Развлечения", keys:[
    "mori sinema","mori_sinema","синема","cinema","кино",
    "tslounge","lounge","duplet","бильярд","bowling","боулинг",
    "playerok","ggsel","pay4game","starsbus","onlypay",
    "ckassa","yp_kleekstore","onlypei","nrp","диалог восток",
  ]},
  { cat:"Кредит / займы", keys:[
    "погашение процентов","погашение основного долга",
    "погашение кредита","гашение долга",
  ]},
  { cat:"Табак", keys:[
    "evo_tabak","tabak 4","tabak","dym par","вейп","vape",
  ]},
  { cat:"ПО и инструменты", keys:[
    "yandex*5815*plus","yandex*5815","яндекс плюс","yandex plus",
    "кинопоиск","kinopoisk","okko","иви","яндекс музыка","яндекс 360",
    "google","apple","microsoft","adobe","jetbrains","notion","figma",
    "github","spotify","netflix","youtube premium","autodesk","revit",
    "telegram premium","discord nitro","chatgpt","openai","canva",
    "kaspersky","dr.web","vseinstrumenti","все инструменты",
  ]},
  { cat:"Связь", keys:[
    "yota_no3ds","yota","йота","мтс","мегафон","билайн",
    "tele2","теле2","ростелеком","beeline",
  ]},
  { cat:"Жильё / аренда", keys:[
    "жкх","квитанция","аренда","управляющая","тсж",
    "водоканал","мосэнерго","газпром","коммунал","еирц",
  ]},
  { cat:"Партнёр",  keys:["партнёр","партнер"] },
  { cat:"Семья",    keys:["родители","семья"] },
  { cat:"Питомцы",  keys:["зоомагазин","chetyre lap","zoomagazin","четыре лапы","зоо","vet ","ветклиника","ветеринар","petshop","pet shop"] },
  { cat:"Дети",     keys:["детский","детская","детсад","детский сад","игрушки","rosnova","школа"] },
  { cat:"Подарки",  keys:["подарок","gift","цветы","флорист","flower","букет"] },
  { cat:"Прочий доход", keys:[
    "капитализация","начисление процентов","кэшбэк","cashback",
    "возврат средств","отмена оплаты","внесение наличных","входящий перевод",
  ]},
];

function guessCategory(description, type = "expense") {
  const d = (description||"").toLowerCase();
  for (const rule of CAT_RULES) {
    if (!rule.keys.length) continue;
    if (rule.keys.some(k => d.includes(k))) {
      if (rule.cat === "Прочий доход" && type === "expense") continue;
      return rule.cat;
    }
  }
  return type === "income" ? "Прочий доход" : "Прочие расходы";
}

function parseTinkoff(rows) {
  const result = [];
  for (const row of rows) {
    if (!row[0] || row[0]==="Дата операции") continue;
    const dateRaw = row[0];
    const parts = dateRaw.split(".");
    if (parts.length < 3) continue;
    const date = `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
    const amountRaw = (row[4]||"").replace(",",".").replace(/\s/g,"");
    const amount = parseFloat(amountRaw);
    if (isNaN(amount) || amount === 0) continue;
    const type    = amount < 0 ? "expense" : "income";
    const abs     = Math.abs(amount);
    const desc    = row[11] || row[8] || "";
    const bankCat = row[9] || "";
    result.push({ date, type, amount:abs, description:desc, bankCategory:bankCat });
  }
  return result;
}

function parseSber(rows) {
  const result = [];
  for (const row of rows) {
    if (!row[0] || row[0]==="Дата") continue;
    const dateRaw = row[0];
    let date = dateRaw;
    if (dateRaw.includes(".")) {
      const p = dateRaw.split(".");
      date = `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;
    }
    const desc      = row[2]||"";
    const expRaw    = (row[3]||"").replace(",",".").replace(/\s/g,"");
    const incRaw    = (row[4]||"").replace(",",".").replace(/\s/g,"");
    const exp       = parseFloat(expRaw)||0;
    const inc       = parseFloat(incRaw)||0;
    if (exp > 0) result.push({ date, type:"expense", amount:exp, description:desc, bankCategory:"" });
    if (inc > 0) result.push({ date, type:"income",  amount:inc, description:desc, bankCategory:"" });
  }
  return result;
}

function parseAlfa(rows) {
  const result = [];
  for (const row of rows) {
    if (!row[0] || row[0]==="Дата") continue;
    const dateRaw = row[0];
    let date = dateRaw;
    if (dateRaw.includes(".")) {
      const p = dateRaw.split(".");
      date = p.length===3 ? `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}` : dateRaw;
    }
    const desc = row[1]||"";
    const raw  = (row[2]||"").replace(",",".").replace(/\s/g,"");
    const amt  = parseFloat(raw);
    if (isNaN(amt)||amt===0) continue;
    result.push({ date, type:amt<0?"expense":"income", amount:Math.abs(amt), description:desc, bankCategory:"" });
  }
  return result;
}

function parseYandex(rows) {
  const result = [];
  for (const row of rows) {
    if (!row[0] || /дата|date/i.test(row[0])) continue;
    const dateRaw = row[0].trim();
    let date = dateRaw;
    if (dateRaw.includes(".")) {
      const p = dateRaw.split(".");
      date = p.length===3
        ? `${p[2].slice(0,4)}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`
        : dateRaw;
    } else if (dateRaw.includes("T")) {
      date = dateRaw.slice(0,10);
    }
    let amount = 0, desc = "", bankCat = "";
    if (row.length >= 4) {
      desc    = row[1]||"";
      bankCat = row[2]||"";
      const raw = (row[3]||"").replace(/\s/g,"").replace(",",".");
      amount  = parseFloat(raw);
    }
    if (isNaN(amount) || amount===0) {
      desc   = row[1]||"";
      const raw = (row[2]||"").replace(/\s/g,"").replace(",",".");
      amount = parseFloat(raw);
      bankCat = "";
    }
    if (isNaN(amount) || amount===0) continue;
    const type = amount < 0 ? "expense" : "income";
    result.push({ date, type, amount:Math.abs(amount), description:desc, bankCategory:bankCat });
  }
  return result;
}

function detectBank(headers) {
  const h = headers.join(";").toLowerCase();
  if (h.includes("дата операции") && h.includes("mcc"))           return "tinkoff";
  if (h.includes("описание") && h.includes("расход") && h.includes("приход")) return "sber";
  if (h.includes("описание операции"))                             return "alfa";
  if (h.includes("яндекс") || h.includes("yandex"))               return "yandex";
  if (/дата|date/i.test(headers[0]) && headers.length >= 3)       return "yandex";
  return "unknown";
}

function parseCSV(text) {
  const sep    = text.includes(";") ? ";" : ",";
  const lines  = text.split(/\r?\n/).filter(l => l.trim());
  const rows   = lines.map(l => l.split(sep).map(c => c.replace(/^"|"$/g,"").trim()));
  if (rows.length < 2) return { bank:"unknown", items:[] };
  const bank   = detectBank(rows[0]);
  let items    = [];
  if      (bank === "tinkoff") items = parseTinkoff(rows.slice(1));
  else if (bank === "sber")    items = parseSber(rows.slice(1));
  else if (bank === "alfa")    items = parseAlfa(rows.slice(1));
  else if (bank === "yandex")  items = parseYandex(rows.slice(1));
  else                         items = parseYandex(rows.slice(1));
  return { bank, items };
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      res(window.pdfjsLib);
    };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function parsePdfYandex(file) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const allItems = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    const vp      = page.getViewport({ scale: 1 });
    for (const item of content.items) {
      const text = item.str.trim();
      if (!text) continue;
      allItems.push({
        text,
        x: Math.round(item.transform[4]),
        y: Math.round((vp.height - item.transform[5]) + (p - 1) * 10000),
      });
    }
  }

  allItems.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);

  const rows = [];
  let curRow = [], lastY = null;
  for (const item of allItems) {
    if (lastY === null || Math.abs(item.y - lastY) <= 8) {
      curRow.push(item);
      lastY = item.y;
    } else {
      if (curRow.length) rows.push([...curRow]);
      curRow = [item];
      lastY = item.y;
    }
  }
  if (curRow.length) rows.push(curRow);

  const SKIP_RE = /входящий остаток|исходящий остаток|итого списаний|итого зачислений|всего расходных|всего приходных|страница \d|продолжение|выписка по договору|номер счёта|описание операции|сумма в валюте|дата.*мск|с уважением|начальник|ао «яндекс банк»|ао «яндекс/i;
  const DATE_RE = /(\d{2}\.\d{2}\.\d{4})/;
  const AMT_RE_ALL = /([+–\-]\s*[\d\s]+,\d{2})\s*₽/g;

  const analyzed = rows.map(row => {
    const fullText = row.map(i => i.text).join(" ");
    const dateM     = fullText.match(DATE_RE);
    const amtAll    = [...fullText.matchAll(AMT_RE_ALL)];
    const lastAmt   = amtAll.length > 0 ? amtAll[amtAll.length - 1] : null;
    const minX      = Math.min(...row.map(i => i.x));
    return { fullText, dateM, lastAmt, minX, skip: SKIP_RE.test(fullText) };
  });

  const transactions = [];
  let i = 0;
  while (i < analyzed.length) {
    const ar = analyzed[i];
    if (ar.skip) { i++; continue; }

    if (ar.dateM && ar.lastAmt) {
      const dp = ar.dateM[1].split(".");
      const date = `${dp[2]}-${dp[1].padStart(2,"0")}-${dp[0].padStart(2,"0")}`;

      const amtStr = ar.lastAmt[1]
        .replace(/\s/g,"").replace(",",".").replace("–","-").replace("−","-");
      const amount = parseFloat(amtStr);
      if (isNaN(amount) || amount === 0) { i++; continue; }

      let desc = ar.fullText
        .replace(/\d{2}\.\d{2}\.\d{4}/g, "")
        .replace(/[+–\-]\s*[\d\s]+,\d{2}\s*₽/g, "")
        .replace(/в\s+\d{2}:\d{2}/g, "")
        .replace(/\*\d{4}/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();

      let j = i + 1;
      while (j < analyzed.length && j < i + 5) {
        const next = analyzed[j];
        if (next.skip || next.dateM || next.lastAmt) break;
        if (next.minX < 250) {
          desc = (desc + " " + next.fullText).replace(/\s{2,}/g," ").trim();
        }
        j++;
      }

      transactions.push({
        date,
        type:        amount < 0 ? "expense" : "income",
        amount:      Math.abs(amount),
        description: desc,
        bankCategory: "",
      });
    }
    i++;
  }
  return transactions;
}

// ════════════════════════════════════════════════════════════════════════════
// TASKS (v6.4a) — вкладка Задачи: список + фильтры, доска (drag-drop), модалка
// ════════════════════════════════════════════════════════════════════════════

function ProjectTasksSection({ projectId, client, profile, showToast }) {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [editing, setEditing] = useState(null);

  const reload = async () => {
    try { setTasks(await fetchTasks(client, { projectId })); }
    catch (e) { showToast("Ошибка задач: " + (e.message || ""), "error"); }
  };
  useEffect(() => { if (projectId) reload(); /* eslint-disable-next-line */ }, [projectId]);

  const quickAdd = async () => {
    if (!title.trim()) return;
    try {
      const id = await createTask(client, { projectId, title, status: "Новая", priority: "Обычный" }, profile.id);
      await notifyTask(client, "task_created", id, profile.id);
      setTitle(""); reload();
    } catch (e) { showToast("Ошибка: " + (e.message || ""), "error"); }
  };

  return (
    <div className="mt-4">
      <div className="text-sm uppercase opacity-70 mb-2">Задачи проекта</div>
      {tasks.map(t => (
        <div key={t.id} onClick={() => setEditing(t)} className="flex justify-between items-center bg-zinc-800/60 rounded px-2 py-1 mb-1 cursor-pointer">
          <span>{t.title}</span>
          <span className="text-xs opacity-60">{t.status}{t.assigneeName ? ` · ${t.assigneeName}` : ""}</span>
        </div>
      ))}
      <div className="flex gap-2 mt-2">
        <input className="flex-1 bg-zinc-800 rounded px-2 py-1" placeholder="+ задача (Enter)"
               value={title} onChange={e => setTitle(e.target.value)}
               onKeyDown={e => { if (e.key === "Enter") quickAdd(); }} />
      </div>
      {editing && <TaskModal task={editing} client={client} profile={profile} projects={[]}
                             onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
                             showToast={showToast} />}
    </div>
  );
}

// Рендер построчного diff (git-стиль): del — красным, add — зелёным, equal — приглушённо.
function DiffView({ oldText, newText }) {
  const segs = diffLines(oldText, newText);
  if (!segs.length) return <div className="text-xs opacity-50 py-1">— пусто —</div>;
  return (
    <div className="font-mono text-xs rounded bg-zinc-950 p-2 overflow-x-auto" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {segs.map((s, i) => {
        if (s.type === "del") return <div key={i} style={{ color: "#f8a3a3", background: "rgba(248,163,163,0.08)" }}>- {s.text || " "}</div>;
        if (s.type === "add") return <div key={i} style={{ color: "#6ee7a8", background: "rgba(110,231,168,0.08)" }}>+ {s.text || " "}</div>;
        return <div key={i} style={{ color: "#a8a8a3" }}>&nbsp;&nbsp;{s.text || " "}</div>;
      })}
    </div>
  );
}

function TaskModal({ task, client, profile, projects, realtimeTick, onClose, onSaved, showToast }) {
  const isNew = !task.id;
  const [form, setForm] = useState({
    projectId: task.projectId || "", assignedTo: task.assignedTo || "",
    title: task.title || "", description: task.description || "",
    status: task.status || "Новая", priority: task.priority || "Обычный",
    dueDate: task.dueDate || "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // 6.4b: исполнитель выбирается из всех одобренных пользователей через
  // search_approved_users (единый источник с ProjectForm). assigneeName хранит
  // отображаемое имя выбранного/назначенного — RPC исключает текущего юзера
  // (id != auth.uid()), поэтому имя самого себя и уже назначенного держим локально.
  const [assigneeName, setAssigneeName] = useState(task.assigneeName || "");
  const [execQuery, setExecQuery] = useState("");
  const [execResults, setExecResults] = useState([]);

  // ── 6.4b: версии ТЗ ──
  const [versions, setVersions] = useState([]);
  const [verLoading, setVerLoading] = useState(false);
  const [editingTz, setEditingTz] = useState(false);
  const [tzDraft, setTzDraft] = useState("");
  const [tzBusy, setTzBusy] = useState(false);
  const [openVerId, setOpenVerId] = useState(null); // версия, раскрытая в истории для diff

  // ── 6.4b: обсуждение ──
  const [comments, setComments] = useState([]);
  const [cmtLoading, setCmtLoading] = useState(false);
  const [cmtText, setCmtText] = useState("");
  const [cmtIsQuestion, setCmtIsQuestion] = useState(false);
  const [cmtSending, setCmtSending] = useState(false);

  const reloadVersions = useCallback(async () => {
    if (isNew || !task.id) return;
    setVerLoading(true);
    try { setVersions(await fetchTaskVersions(client, task.id)); }
    catch (e) { showToast("Ошибка загрузки версий ТЗ: " + (e.message || ""), "error"); }
    finally { setVerLoading(false); }
  }, [isNew, task.id, client, showToast]);
  useEffect(() => { reloadVersions(); }, [reloadVersions]);

  const reloadComments = useCallback(async () => {
    if (isNew || !task.id) return;
    setCmtLoading(true);
    try { setComments(await fetchTaskComments(client, task.id)); }
    catch (e) { showToast("Ошибка загрузки обсуждения: " + (e.message || ""), "error"); }
    finally { setCmtLoading(false); }
  }, [isNew, task.id, client, showToast]);
  useEffect(() => { reloadComments(); }, [reloadComments]);

  // 6.4b: realtime-сигнал по открытой задаче -> рефетч дочерних данных
  useEffect(() => {
    if (realtimeTick) { reloadVersions(); reloadComments(); }
  }, [realtimeTick, reloadVersions, reloadComments]);

  // действующая (последняя approved) и pending
  const approvedVers = versions.filter(v => v.status === "approved");
  const currentVer = approvedVers.length ? approvedVers[approvedVers.length - 1] : null;
  const currentTz = currentVer ? currentVer.content : (task.description || "");
  const pendingVer = versions.find(v => v.status === "pending") || null;
  // противоположная сторона относительно предложившего pending
  const isProposer = pendingVer && pendingVer.proposedBy === profile.id;
  const isParty = task.authorId === profile.id || task.assignedTo === profile.id;
  const canDecide = pendingVer && !isProposer && isParty;

  const openQuestions = comments.filter(c => c.isQuestion && !c.resolved).length;
  const canResolveQ = task.authorId === profile.id || task.assignedTo === profile.id || profile.role === "admin";

  const proposeTz = async () => {
    if (!tzDraft.trim()) { showToast("Текст ТЗ пуст", "error"); return; }
    setTzBusy(true);
    try {
      await proposeTzVersion(client, task.id, tzDraft);
      setEditingTz(false); setTzDraft("");
      await reloadVersions();
      notifyTask(client, "task_tz_proposed", task.id, profile.id);
      showToast("Изменение ТЗ предложено");
    } catch (e) {
      const m = e.message || "";
      if (m.includes("tz_pending_exists")) showToast("Уже есть ожидающее изменение ТЗ — дождитесь решения", "error");
      else showToast("Ошибка: " + m, "error");
    } finally { setTzBusy(false); }
  };
  const decideTz = async (approve) => {
    if (!pendingVer) return;
    try {
      if (approve) { await approveTzVersion(client, pendingVer.id); notifyTask(client, "task_tz_approved", task.id, profile.id); }
      else { await rejectTzVersion(client, pendingVer.id); notifyTask(client, "task_tz_rejected", task.id, profile.id); }
      await reloadVersions();
      showToast(approve ? "Изменение ТЗ принято" : "Изменение ТЗ отклонено");
    } catch (e) {
      const m = e.message || "";
      if (m.includes("proposer_cannot_approve")) showToast("Свою версию подтверждает другая сторона", "error");
      else showToast("Ошибка: " + m, "error");
    }
  };

  const sendComment = async () => {
    if (!cmtText.trim()) return;
    setCmtSending(true);
    try {
      const wasQuestion = cmtIsQuestion;
      await insertTaskComment(client, task.id, cmtText.trim(), wasQuestion);
      setCmtText(""); setCmtIsQuestion(false);
      await reloadComments();
      if (wasQuestion) notifyTask(client, "task_question", task.id, profile.id);
    } catch (e) { showToast("Ошибка отправки: " + (e.message || ""), "error"); }
    finally { setCmtSending(false); }
  };
  const toggleResolve = async (commentId, val) => {
    try { await resolveTaskQuestion(client, commentId, val); await reloadComments(); }
    catch (e) { showToast("Ошибка: " + (e.message || ""), "error"); }
  };

  // 6.4b: autocomplete по одобренным пользователям (как в ProjectForm).
  // search_approved_users исключает самого себя, поэтому текущего пользователя
  // добавляем в результаты вручную, если он подходит под запрос.
  useEffect(() => {
    if (!client || !execQuery.trim()) { setExecResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await searchApprovedUsers(client, execQuery);
        const q = execQuery.trim().toLowerCase();
        const selfMatches = profile?.id &&
          ((profile.name || "").toLowerCase().includes(q) || (profile.email || "").toLowerCase().includes(q));
        const out = (selfMatches && !res.some(u => u.id === profile.id))
          ? [{ id: profile.id, name: profile.name, email: profile.email }, ...res]
          : res;
        setExecResults(out);
      } catch { setExecResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [execQuery, client, profile]); // eslint-disable-line

  const selectAssignee = (user) => {
    setForm(f => ({ ...f, assignedTo: user.id }));
    setAssigneeName(user.name || user.email || "");
    setExecQuery("");
    setExecResults([]);
  };
  const clearAssignee = () => {
    setForm(f => ({ ...f, assignedTo: "" }));
    setAssigneeName("");
    setExecQuery("");
    setExecResults([]);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) { showToast("Заголовок обязателен", "error"); return; }
    setSaving(true);
    try {
      if (isNew) {
        const id = await createTask(client, form, profile.id);
        if (form.assignedTo) await notifyTask(client, "task_assigned", id, profile.id);
        if (form.projectId) await notifyTask(client, "task_created", id, profile.id);
      } else {
        const assigneeChanged = (task.assignedTo || "") !== (form.assignedTo || "");
        const statusChanged = task.status !== form.status;
        // явный whitelist полей: description версионируется отдельно (RPC),
        // status меняется через setTaskStatus ниже — здесь их не шлём.
        await updateTask(client, task.id, {
          title: form.title,
          projectId: form.projectId,
          assignedTo: form.assignedTo,
          priority: form.priority,
          dueDate: form.dueDate,
        });
        if (statusChanged) {
          try { await setTaskStatus(client, task.id, form.status); }
          catch (e) {
            if ((e.message || "").includes("only_author_can_complete")) { showToast("В «Готово» переводит только автор задачи", "error"); setSaving(false); return; }
            throw e;
          }
        }
        if (assigneeChanged && form.assignedTo) await notifyTask(client, "task_assigned", task.id, profile.id);
        if (statusChanged) await notifyTask(client, "task_status", task.id, profile.id);
      }
      onSaved();
    } catch (e) { showToast("Ошибка сохранения: " + (e.message || ""), "error"); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!task.id) return;
    try { await deleteTask(client, task.id); onSaved(); }
    catch (e) { showToast("Ошибка удаления: " + (e.message || ""), "error"); }
  };

  const accept = async () => {
    try {
      await setTaskStatus(client, task.id, "В работе");
      await notifyTask(client, "task_status", task.id, profile.id);
      onSaved();
    } catch (e) { showToast("Ошибка: " + (e.message || ""), "error"); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-zinc-900 rounded-lg p-5 w-[min(560px,92vw)]" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">{isNew ? "Новая задача" : "Задача"}</h3>
        <input className="w-full bg-zinc-800 rounded px-3 py-2 mb-2" placeholder="Заголовок"
               value={form.title} onChange={e => set("title", e.target.value)} />
        {isNew ? (
          <textarea className="w-full bg-zinc-800 rounded px-3 py-2 mb-2" rows={4} placeholder="Описание (ТЗ)"
                 value={form.description} onChange={e => set("description", e.target.value)} />
        ) : (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase opacity-60">Техническое задание</span>
              {!editingTz && !pendingVer && (
                <button onClick={() => { setEditingTz(true); setTzDraft(currentTz); }}
                        className="text-xs text-amber-400 underline">Изменить ТЗ</button>
              )}
            </div>
            {!editingTz && (
              <div className="bg-zinc-800 rounded px-3 py-2 text-sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {currentTz || <span className="opacity-50">— ТЗ не задано —</span>}
              </div>
            )}
            {editingTz && (
              <div>
                <textarea className="w-full bg-zinc-800 rounded px-3 py-2" rows={5}
                          value={tzDraft} onChange={e => setTzDraft(e.target.value)} />
                <div className="flex gap-2 mt-1">
                  <button onClick={proposeTz} disabled={tzBusy}
                          className="px-3 py-1 rounded bg-amber-500 text-black text-sm font-semibold">
                    {tzBusy ? "…" : "Предложить изменение"}</button>
                  <button onClick={() => { setEditingTz(false); setTzDraft(""); }}
                          className="px-3 py-1 rounded bg-zinc-700 text-sm">Отмена</button>
                </div>
              </div>
            )}

            {/* Баннер pending-версии */}
            {pendingVer && (
              <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/5 p-2">
                <div className="text-xs font-semibold text-amber-300 mb-1">
                  Предложены изменения ТЗ · v{pendingVer.versionNo} · {pendingVer.proposedByName} · {fmtDT(pendingVer.createdAt)}
                </div>
                <DiffView oldText={currentTz} newText={pendingVer.content} />
                {canDecide ? (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => decideTz(true)} className="px-3 py-1 rounded bg-emerald-600 text-white text-sm font-semibold">Принять</button>
                    <button onClick={() => decideTz(false)} className="px-3 py-1 rounded bg-red-600 text-white text-sm font-semibold">Отклонить</button>
                  </div>
                ) : (
                  <div className="text-xs opacity-60 mt-2">{isProposer ? "Ожидает подтверждения другой стороны" : "Решение принимает сторона задачи"}</div>
                )}
              </div>
            )}

            {/* История ТЗ */}
            {versions.length > 0 && (
              <div className="mt-3">
                <div className="text-xs uppercase opacity-60 mb-1">История ТЗ</div>
                {verLoading ? <div className="text-xs opacity-50">Загрузка…</div> : versions.slice().reverse().map(v => {
                  // diff против предыдущей approved-версии (по version_no)
                  const prevApproved = approvedVers.filter(a => a.versionNo < v.versionNo).slice(-1)[0] || null;
                  const opened = openVerId === v.id;
                  const stColor = v.status === "approved" ? "#6ee7a8" : v.status === "pending" ? "#d4af37" : "#f8a3a3";
                  return (
                    <div key={v.id} className="border-b border-white/5 py-1">
                      <button onClick={() => setOpenVerId(opened ? null : v.id)} className="flex items-center gap-2 text-xs w-full text-left">
                        <span style={{ color: stColor }}>●</span>
                        <span className="opacity-80">v{v.versionNo}</span>
                        <span className="opacity-60">{v.proposedByName}</span>
                        <span className="opacity-40">{fmtDT(v.createdAt)}</span>
                        <span className="opacity-50">{v.status}</span>
                      </button>
                      {opened && (
                        <div className="mt-1">
                          {prevApproved
                            ? <DiffView oldText={prevApproved.content} newText={v.content} />
                            : <DiffView oldText="" newText={v.content} />}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <select className="bg-zinc-800 rounded px-2 py-2" value={form.projectId} onChange={e => set("projectId", e.target.value)}>
            <option value="">Без проекта (личная)</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {form.assignedTo ? (
            <div className="bg-zinc-800 rounded px-2 py-2 flex items-center gap-2">
              <span className="text-xs opacity-60 shrink-0">Исполнитель:</span>
              <span className="truncate flex-1">{assigneeName || "—"}</span>
              <button type="button" onClick={clearAssignee}
                className="text-zinc-400 hover:text-zinc-100 shrink-0" title="Сбросить исполнителя">×</button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <input className="w-full bg-zinc-800 rounded px-2 py-2" placeholder="Исполнитель: поиск по имени/почте"
                value={execQuery} onChange={e => setExecQuery(e.target.value)}
                onBlur={() => setTimeout(() => setExecResults([]), 200)} />
              {execResults.length > 0 && (
                <div className="absolute left-0 right-0 z-50 mt-1 bg-zinc-800 border border-white/10 rounded overflow-hidden">
                  {execResults.map(u => (
                    <div key={u.id} onMouseDown={() => selectAssignee(u)}
                      className="px-3 py-2 cursor-pointer text-sm hover:bg-zinc-700 flex items-center gap-2">
                      <span className="text-zinc-100">{u.name || u.email}</span>
                      {u.name && <span className="text-zinc-500 text-xs truncate">{u.email}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <select className="bg-zinc-800 rounded px-2 py-2" value={form.status} onChange={e => set("status", e.target.value)}>
            {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="bg-zinc-800 rounded px-2 py-2" value={form.priority} onChange={e => set("priority", e.target.value)}>
            {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input type="date" className="bg-zinc-800 rounded px-2 py-2" value={form.dueDate || ""} onChange={e => set("dueDate", e.target.value)} />
        </div>

        {!isNew && (
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs uppercase opacity-60">Обсуждение</span>
              {openQuestions > 0 && (
                <span className="text-xs font-semibold text-amber-300 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
                  {openQuestions} {openQuestions === 1 ? "открытый вопрос" : "открытых вопросов"}
                </span>
              )}
            </div>
            {cmtLoading ? <div className="text-xs opacity-50">Загрузка…</div> :
             comments.length === 0 ? <div className="text-xs opacity-50 mb-2">Пока нет сообщений</div> :
             <div className="mb-2 max-h-60 overflow-y-auto">
               {comments.map(c => (
                 <div key={c.id} className="flex gap-2 py-2 border-b border-white/5">
                   <UserAvatar name={c.authorName} size={26} />
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 flex-wrap">
                       <span className="text-xs font-semibold text-zinc-100">{c.authorName}</span>
                       <span className="text-[10px] opacity-50">{fmtDT(c.createdAt)}</span>
                       {c.isQuestion && (
                         <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                           color: c.resolved ? "#6ee7a8" : "#d4af37",
                           background: c.resolved ? "rgba(110,231,168,0.08)" : "rgba(212,175,55,0.10)",
                           border: `1px solid ${c.resolved ? "rgba(110,231,168,0.25)" : "rgba(212,175,55,0.30)"}`,
                         }}>{c.resolved ? "✓ вопрос решён" : "вопрос"}</span>
                       )}
                     </div>
                     <p className="m-0 text-sm text-zinc-300" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{c.body}</p>
                     {c.isQuestion && canResolveQ && (
                       c.resolved
                         ? <button onClick={() => toggleResolve(c.id, false)} className="text-[11px] text-zinc-500 underline mt-1">↩ Переоткрыть</button>
                         : <button onClick={() => toggleResolve(c.id, true)} className="text-[11px] text-emerald-400 underline mt-1">✓ Пометить решённым</button>
                     )}
                   </div>
                 </div>
               ))}
             </div>}
            <div className="flex gap-2 items-end">
              <textarea value={cmtText} onChange={e => setCmtText(e.target.value)} rows={2}
                        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendComment(); }}
                        placeholder="Сообщение… (Ctrl+Enter — отправить)"
                        className="flex-1 bg-zinc-800 rounded px-3 py-2 text-sm" style={{ resize: "none" }} />
              <button onClick={sendComment} disabled={cmtSending || !cmtText.trim()}
                      className="px-3 py-2 rounded bg-amber-500 text-black text-sm font-semibold whitespace-nowrap">
                {cmtSending ? "…" : "Отправить"}</button>
            </div>
            <label className="flex items-center gap-1 text-xs mt-1 opacity-80">
              <input type="checkbox" checked={cmtIsQuestion} onChange={e => setCmtIsQuestion(e.target.checked)} /> Это вопрос
            </label>
          </div>
        )}

        <div className="flex justify-between mt-3">
          {!isNew ? <button onClick={() => confirmDel ? remove() : setConfirmDel(true)} className="text-red-400 text-sm">{confirmDel ? "Точно удалить?" : "Удалить"}</button> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded bg-zinc-700">Отмена</button>
            {!isNew && task.assignedTo === profile.id && task.status === "Новая" && <button onClick={accept} className="px-3 py-1.5 rounded bg-emerald-600 text-white font-semibold">Принять в работу</button>}
            <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded bg-amber-500 text-black font-semibold">
              {saving ? "…" : "Сохранить"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TasksBoard({ tasks, onOpen, onReload, client, profile, badge, showToast }) {
  // колонки доски — без «Отменена» (намеренно); при добавлении статусов в TASK_STATUSES обновить вручную
  const cols = ["Новая", "В работе", "На проверке", "Готово"];
  const [dragId, setDragId] = useState(null);
  const move = async (taskId, toStatus) => {
    const t = tasks.find(x => x.id === taskId);
    if (!t || t.status === toStatus) return;
    try {
      await setTaskStatus(client, taskId, toStatus);
      await notifyTask(client, "task_status", taskId, profile.id);
      onReload();
    } catch (e) {
      const m = e.message || "";
      if (m.includes("only_author_can_complete")) showToast("В «Готово» переводит только автор задачи", "error");
      else showToast("Ошибка смены статуса: " + m, "error");
      onReload();
    }
  };
  return (
    <div className="flex gap-3 overflow-x-auto">
      {cols.map(col => (
        <div key={col} onDragOver={e => e.preventDefault()}
             onDrop={() => { if (dragId) move(dragId, col); setDragId(null); }}
             className="min-w-[200px] flex-1 bg-zinc-900/50 rounded p-2">
          <div className="text-xs uppercase opacity-60 mb-2">{col}</div>
          {tasks.filter(t => t.status === col).map(t => (
            <div key={t.id} draggable onDragStart={() => setDragId(t.id)} onClick={() => onOpen(t)}
                 className="bg-zinc-800 rounded p-2 mb-2 cursor-pointer">
              <div className="text-sm font-medium">{t.title}</div>
              <div className="text-xs opacity-60">{t.projectName || "личная"} · {t.assigneeName || "—"}</div>
              {t.dueDate && <div className="text-xs opacity-50">⏱ {t.dueDate}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TasksView({ client, profile, projects, showToast }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list");
  const [fProject, setFProject] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [editing, setEditing] = useState(null);
  // ref на открытую задачу: realtime-колбэк читает editingRef.current, чтобы
  // открытие/закрытие модалки не пересоздавало канал (иначе churn -> потеря событий).
  const editingRef = useRef(null);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchTasks(client, {
        projectId: fProject || null, status: fStatus || null,
        assignedTo: onlyMine ? profile.id : null,
      });
      setTasks(list);
    } catch (e) { showToast("Ошибка загрузки задач: " + (e.message || ""), "error"); }
    finally { setLoading(false); }
  }, [fProject, fStatus, onlyMine, client, profile, showToast]);
  useEffect(() => { reload(); }, [reload]);

  // ── 6.4b: Realtime-подписка на project_tasks ──
  // tick инкрементируется при realtime-событии по id открытой задачи -> модалка
  // делает refetch версий/комментариев (дочерние таблицы не в publication).
  const [openTaskTick, setOpenTaskTick] = useState(0);

  // клиентский фолбэк-фильтр приватности: пускаем строку в состояние только если
  // она проходит базовую проверку доступа (страховка поверх RLS на канале).
  const canSeeRow = useCallback((row) => {
    if (!row) return false;
    if (profile?.role === "admin") return true;
    if (row.project_id == null) {
      // личная задача: видит автор или исполнитель
      return row.author_id === profile.id || row.assigned_to === profile.id;
    }
    // проектная: видна, если проект уже в доступном списке (projects проп) ИЛИ
    // пользователь — сторона задачи. Жёстче серверной RLS, но безопасно (не «течёт»).
    return projects.some(p => p.id === row.project_id) || row.author_id === profile.id || row.assigned_to === profile.id;
  }, [profile, projects]);

  useEffect(() => {
    const channel = client
      .channel("project_tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "project_tasks" }, (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload;
        setTasks(prev => {
          if (eventType === "DELETE") return prev.filter(t => t.id !== oldRow.id);
          if (!canSeeRow(newRow)) {
            // строка вне доступа — убираем, если вдруг была в состоянии
            return prev.filter(t => t.id !== newRow.id);
          }
          const mapped = taskDbToJs(newRow); // payload не содержит *_name -> projectName/assigneeName будут null
          // сохраняем уже известные denormalized-имена из текущего состояния (payload их не несёт)
          const existing = prev.find(t => t.id === mapped.id);
          const merged = existing
            ? { ...mapped, projectName: mapped.projectName ?? existing.projectName, assigneeName: mapped.assigneeName ?? existing.assigneeName, authorName: mapped.authorName ?? existing.authorName }
            : mapped;
          const idx = prev.findIndex(t => t.id === merged.id);
          if (idx === -1) return [merged, ...prev];
          const copy = prev.slice(); copy[idx] = merged; return copy;
        });
        // точечный сигнал открытой карточке (через ref, чтобы не пересоздавать канал)
        const rid = (payload.new && payload.new.id) || (payload.old && payload.old.id);
        const open = editingRef.current;
        if (open && open.id && rid === open.id) setOpenTaskTick(t => t + 1);
      })
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, canSeeRow]);

  const badge = (s) => TASK_STATUS_BADGE[s] || "bg-zinc-600";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <button onClick={() => setView("list")} className={view === "list" ? "font-bold" : "opacity-60"}>Список</button>
          <button onClick={() => setView("board")} className={view === "board" ? "font-bold" : "opacity-60"}>Доска</button>
        </div>
        <button onClick={() => setEditing({ status: "Новая", priority: "Обычный" })}
                className="px-3 py-1.5 rounded bg-amber-500 text-black font-semibold">+ Новая задача</button>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <select value={fProject} onChange={e => setFProject(e.target.value)} className="bg-zinc-800 rounded px-2 py-1">
          <option value="">Все проекты</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="bg-zinc-800 rounded px-2 py-1">
          <option value="">Все статусы</option>
          {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> только мои
        </label>
      </div>
      {loading ? <div className="opacity-60">Загрузка…</div> :
       view === "board" ? <TasksBoard tasks={tasks} onOpen={setEditing} onReload={reload} client={client} profile={profile} badge={badge} showToast={showToast} /> :
       <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
         <table className="w-full text-sm" style={{ minWidth: 560 }}>
           <thead><tr className="text-left opacity-60">
             <th>Статус</th><th>Задача</th><th>Проект</th><th>Исполнитель</th><th>Приоритет</th><th>Срок</th>
           </tr></thead>
           <tbody>
             {tasks.map(t => (
               <tr key={t.id} onClick={() => setEditing(t)} className="cursor-pointer hover:bg-zinc-800/50">
                 <td><span className={"px-2 py-0.5 rounded text-xs text-white " + badge(t.status)}>{t.status}</span></td>
                 <td>{t.title}</td><td>{t.projectName || "—"}</td><td>{t.assigneeName || "—"}</td>
                 <td>{t.priority}</td><td>{t.dueDate || "—"}</td>
               </tr>
             ))}
             {!tasks.length && <tr><td colSpan={6} className="opacity-60 py-4">Задач нет</td></tr>}
           </tbody>
         </table>
       </div>}
      {editing && <TaskModal task={editing} client={client} profile={profile} projects={projects}
                             realtimeTick={openTaskTick}
                             onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }}
                             showToast={showToast} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CSV IMPORT MODAL — без изменений в UI, только handleImport теперь bulk-insert
// ════════════════════════════════════════════════════════════════════════════
function CsvImportModal({ onClose, onImport }) {
  const [step, setStep]       = useState("upload");
  const [bank, setBank]       = useState("");
  const [parsed, setParsed]   = useState([]);
  const [edited, setEdited]   = useState([]);
  const [importing, setImporting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const fileRef = useRef();

  const BANK_LABELS = { tinkoff:"Тинькофф", sber:"Сбербанк", alfa:"Альфа-банк", yandex:"Яндекс Пэй / Яндекс Банк", unknown:"Определяется..." };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      setPdfLoading(true);
      try {
        const items = await parsePdfYandex(file);
        setBank("yandex");
        const enriched = items.map((item, i) => ({
          ...item, id:i,
          category:guessCategory(item.description, item.type),
          skip: /перевод между счетами одного клиента/i.test(item.description||""),
        }));
        setParsed(enriched);
        setEdited(enriched);
        setStep("preview");
      } catch(err) {
        console.error(err);
      } finally { setPdfLoading(false); }
      return;
    }

    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      const { bank: b, items } = parseCSV(text);
      setBank(b);
      const enriched = items.map((item, i) => ({
        ...item, id:i,
        category:guessCategory(item.description, item.type),
        skip: /перевод между счетами одного клиента/i.test(item.description||""),
      }));
      setParsed(enriched);
      setEdited(enriched);
      setStep("preview");
    };
    reader.readAsText(file, "windows-1251");
  };

  const toggleSkip  = (id) => setEdited(e => e.map(r => r.id===id ? {...r, skip:!r.skip} : r));
  const changeCat   = (id, cat) => setEdited(e => e.map(r => r.id===id ? {...r, category:cat} : r));
  const changeType  = (id, type) => setEdited(e => e.map(r => r.id===id ? {...r, type} : r));
  const changeDesc  = (id, desc) => setEdited(e => e.map(r => r.id===id ? {...r, description:desc} : r));

  const cleanDesc = (raw) => {
    let s = (raw||"");
    s = s.replace(/^Оплата товаров и услуг\s+/i, "");
    s = s.replace(/^Оплата СБП QR\s*/i, "");
    s = s.replace(/^Оплата Сбер\s+[A-Za-zА-Яа-яЁё]+\s+/i, "");
    s = s.replace(/^Исходящий перевод СБП,?\s*/i, "");
    s = s.replace(/^Входящий перевод СБП,?\s*/i, "");
    s = s.replace(/^Перевод между счетами одного клиента\s*/i, "Внутренний перевод");
    s = s.replace(/^Погашение\s+/i, "Кредит: ");
    s = s.replace(/^Внесение наличных в банкомате\s*/i, "Пополнение наличными");
    s = s.replace(/^Возврат средств\s+/i, "Возврат: ");
    s = s.replace(/\+7[\d\s\-()+]{9,}/g, "");
    s = s.replace(/\d{2}\.\d{2}\.\d{4}/g, "");
    s = s.replace(/в\s+\d{2}:\d{2}/g, "");
    s = s.replace(/\*\d{4}/g, "");
    s = s.replace(/[–\-+]\s*[\d\s]+,\d{2}/g, "");
    s = s.replace(/,\s*(Сбербанк|ВТБ|Т-Банк|Т-банк|Альфа-Банк|МКБ|Wildberries \(Вайлдберриз Банк\)|Wildberries|Озон Банк|Россельхозбанк|Совкомбанк|Сбер)\s*$/i, "");
    s = s.replace(/[,;]\s*$/, "").replace(/\s{2,}/g, " ").trim();
    const words = s.split(" ").filter(w => w.length > 1);
    return words.slice(0, 6).join(" ") || (raw||"").trim();
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const toAdd = edited.filter(r => !r.skip);
      await onImport(toAdd);
      setStep("done");
    } catch (e) {
      console.error("Ошибка импорта:", e);
    } finally {
      setImporting(false);
    }
  };

  const toImport = edited.filter(r => !r.skip);
  const cats     = [...INCOME_CATS, ...EXPENSE_CATS];

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:100,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16,
      background:"rgba(2,8,23,0.92)",backdropFilter:"blur(6px)",
    }}>
      <div style={{
        background:"#141414",border:"1px solid #141414",borderRadius:20,
        width:"100%",maxWidth: step==="preview" ? 740 : 460,
        maxHeight:"90vh",overflowY:"auto",
        boxShadow:"0 25px 60px rgba(0,0,0,.6)",
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"16px 24px",borderBottom:"1px solid #141414",position:"sticky",top:0,
          background:"#141414",zIndex:1}}>
          <div>
            <h3 style={{color:"white",fontWeight:700,fontSize:16,margin:0}}>📂 Импорт из банка</h3>
            {step==="preview" && <p style={{fontSize:11,color:"#6b6b67",marginTop:2}}>
              Банк: <span style={{color:"#e8c860",fontWeight:600}}>{BANK_LABELS[bank]||bank}</span>
              {" · "}{parsed.length} операций найдено
            </p>}
          </div>
          <button onClick={onClose} style={{
            background:"#141414",border:"none",color:"#a8a8a3",
            width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:18,
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>×</button>
        </div>

        <div style={{padding:"20px 24px"}}>
          {step==="upload" && (
            <div>
              <p style={{fontSize:13,color:"#a8a8a3",marginBottom:16,lineHeight:1.5}}>
                Загрузи файл выписки из банка. Поддерживаются CSV (Тинькофф, Сбер, Альфа, Яндекс)
                и PDF (Яндекс Банк). Все операции пройдут автокатегоризацию,
                и ты сможешь проверить и подправить категории перед импортом.
              </p>
              <input ref={fileRef} type="file" accept=".csv,.pdf" onChange={handleFile} style={{display:"none"}}/>
              <button onClick={()=>fileRef.current?.click()} disabled={pdfLoading} style={{
                width:"100%",padding:"32px 16px",borderRadius:14,
                background:"#141414",border:"2px dashed #1c1c1a",
                color:pdfLoading?"#6b6b67":"#fafaf7",fontSize:14,fontWeight:600,
                cursor:pdfLoading?"wait":"pointer",
              }}>
                {pdfLoading ? "Парсим PDF..." : "📁 Выбрать файл (.csv или .pdf)"}
              </button>
            </div>
          )}

          {step==="preview" && <>
            <div style={{
              display:"flex",gap:12,marginBottom:16,padding:"12px 16px",
              background:"#141414",borderRadius:12,flexWrap:"wrap"
            }}>
              {[
                {label:"Найдено",  val:parsed.length,             color:"#e8c860"},
                {label:"Импортируем", val:toImport.length,        color:"#6ee7a8"},
                {label:"Пропускаем", val:edited.filter(r=>r.skip).length, color:"#f59e0b"},
                {label:"Расходов", val:toImport.filter(r=>r.type==="expense").length, color:"#f8a3a3"},
                {label:"Доходов",  val:toImport.filter(r=>r.type==="income").length,  color:"#d4af37"},
              ].map(s=>(
                <div key={s.label} style={{textAlign:"center",minWidth:70}}>
                  <div style={{fontSize:10,color:"#6b6b67",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em"}}>{s.label}</div>
                  <div style={{fontSize:18,fontWeight:900,color:s.color,marginTop:2}}>{s.val}</div>
                </div>
              ))}
            </div>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:11,color:"#6b6b67",fontWeight:600}}>
                Нажми на название чтобы отредактировать. ✂ — автоочистка длинного текста.
              </div>
              <button
                onClick={()=>setEdited(e=>e.map(r=>({...r,description:cleanDesc(r.description)})))}
                style={{
                  background:"#141414",border:"1px solid #2d3f55",borderRadius:8,
                  color:"#a8a8a3",fontSize:11,fontWeight:700,cursor:"pointer",
                  padding:"5px 12px",flexShrink:0,whiteSpace:"nowrap",
                }}>✂ Очистить все названия</button>
            </div>

            <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:16}}>
            <div style={{border:"1px solid #141414",borderRadius:12,overflow:"hidden",minWidth:440}}>
              <div style={{
                display:"grid",gridTemplateColumns:"90px 1fr 130px 90px 32px",gap:8,
                padding:"8px 12px",background:"#131d2e",
                fontSize:10,fontWeight:700,color:"#404040",textTransform:"uppercase",letterSpacing:".08em"
              }}>
                <span>Дата</span><span>Описание</span><span>Категория</span>
                <span style={{textAlign:"right"}}>Сумма</span><span></span>
              </div>
              <div style={{maxHeight:380,overflowY:"auto"}}>
                {edited.map(row=>(
                  <div key={row.id} style={{
                    display:"grid",gridTemplateColumns:"90px 1fr 130px 90px 32px",gap:8,
                    padding:"8px 12px",borderTop:"1px solid #141414",alignItems:"center",
                    opacity:row.skip?0.35:1,transition:"opacity .15s",
                    background:row.skip?"transparent":(row.type==="income"?"#d4af3708":"transparent"),
                  }}>
                    <span style={{fontSize:11,color:"#6b6b67",whiteSpace:"nowrap"}}>{fmtD(row.date)}</span>
                    <div style={{minWidth:0}}>
                      <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:3}}>
                        <input
                          value={row.description||""}
                          onChange={e=>changeDesc(row.id, e.target.value)}
                          style={{
                            flex:1,background:"#0a0a0a",border:"1px solid #141414",
                            borderRadius:6,padding:"3px 7px",fontSize:12,
                            color:"white",WebkitTextFillColor:"white",
                            outline:"none",minWidth:0,
                          }}
                          onFocus={e=>e.target.style.borderColor="#d4af37"}
                          onBlur={e=>e.target.style.borderColor="#141414"}
                        />
                        <button
                          onClick={()=>changeDesc(row.id, cleanDesc(row.description))}
                          style={{
                            background:"#141414",border:"none",borderRadius:5,
                            color:"#6b6b67",fontSize:11,cursor:"pointer",
                            padding:"3px 6px",flexShrink:0,fontWeight:700,
                          }}>✂</button>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        {["expense","income"].map(t=>(
                          <button key={t} onClick={()=>changeType(row.id,t)} style={{
                            padding:"1px 7px",borderRadius:6,border:"none",cursor:"pointer",fontSize:10,fontWeight:700,
                            background: row.type===t ? (t==="income"?"#d4af3722":"#f8a3a322") : "#141414",
                            color: row.type===t ? (t==="income"?"#d4af37":"#f8a3a3") : "#404040",
                          }}>{t==="income"?"Доход":"Расход"}</button>
                        ))}
                      </div>
                    </div>
                    <select
                      value={row.category}
                      onChange={e=>changeCat(row.id,e.target.value)}
                      style={{
                        background:"#131d2e",border:"1px solid #141414",borderRadius:6,
                        color:"white",WebkitTextFillColor:"white",fontSize:11,padding:"4px 6px",
                        width:"100%",colorScheme:"dark",
                      }}>
                      {cats.map(c=><option key={c}>{c}</option>)}
                    </select>
                    <div style={{
                      textAlign:"right",fontSize:12,fontWeight:700,
                      color:row.type==="income"?"#d4af37":"#f8a3a3",whiteSpace:"nowrap"
                    }}>
                      {row.type==="income"?"+":"−"}{Math.round(row.amount).toLocaleString("ru-RU")}
                    </div>
                    <button onClick={()=>toggleSkip(row.id)} style={{
                      background:"none",border:"none",cursor:"pointer",
                      color:row.skip?"#6ee7a8":"#404040",fontSize:16,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      transition:"color .15s",
                    }}>{row.skip?"↩":"×"}</button>
                  </div>
                ))}
              </div>
            </div>
            </div>

            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setStep("upload")} style={{
                flex:1,padding:"12px",borderRadius:12,background:"#141414",border:"none",
                color:"#a8a8a3",fontSize:14,fontWeight:600,cursor:"pointer",
              }}>← Назад</button>
              <button onClick={doImport} disabled={importing||toImport.length===0} style={{
                flex:2,padding:"12px",borderRadius:12,background:"#d4af37",border:"none",
                color:"white",fontSize:14,fontWeight:700,cursor:"pointer",
                opacity:toImport.length===0?0.5:1,
              }}>
                {importing?"Импортируем в Supabase...": `✓ Импортировать ${toImport.length} операций`}
              </button>
            </div>
          </>}

          {step === "done" && (
            <div style={{textAlign:"center",padding:"32px 16px"}}>
              <div style={{fontSize:48,marginBottom:16}}>✅</div>
              <div style={{fontSize:18,fontWeight:800,color:"white",marginBottom:8}}>
                Импорт завершён!
              </div>
              <div style={{fontSize:13,color:"#6b6b67",marginBottom:24}}>
                {toImport.length} операций добавлены в финансы
              </div>
              <button onClick={onClose} style={{
                padding:"12px 32px",borderRadius:12,background:"#d4af37",border:"none",
                color:"white",fontSize:14,fontWeight:700,cursor:"pointer",
              }}>Отлично 👍</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FINANCE
// ════════════════════════════════════════════════════════════════════════════
function Finance({ txs, setTxs, client, ownerId, showToast }) {
  const [modal, setModal]           = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [monthF, setMonthF]         = useState(todayStr().slice(0,7));
  const [csvModal, setCsvModal]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [saving, setSaving]         = useState(false);

  const handleCsvImport = async (rows) => {
    // Bulk-вставка пакета транзакций в Supabase, потом обновляем локальный state
    const inserted = await insertTransactionsBulk(client, rows, ownerId);
    setTxs(prev => [...inserted, ...prev]);
    showToast(`✓ Импортировано ${inserted.length} транзакций`);
  };

  const saveTx = async (form) => {
    setSaving(true);
    try {
      if (modal === "add") {
        const created = await insertTransaction(client, form, ownerId);
        setTxs(prev => [created, ...prev]);
        showToast("✓ Запись добавлена");
      } else {
        const updated = await updateTransaction(client, modal.id, form, ownerId);
        setTxs(prev => prev.map(t => t.id === updated.id ? updated : t));
        showToast("✓ Запись обновлена");
      }
      setModal(null);
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    try {
      await deleteTransactionDb(client, id);
      setTxs(prev => prev.filter(t=>t.id!==id));
      showToast("Запись удалена");
    } catch (e) {
      showToast("Ошибка удаления: " + (e.message || ""), "error");
    } finally {
      setConfirmDel(null);
    }
  };

  const filtered = txs
    .filter(t=>typeFilter==="all"||t.type===typeFilter)
    .filter(t=>!monthF||t.date.startsWith(monthF))
    .sort((a,b)=>b.date.localeCompare(a.date));

  const inc = filtered.filter(t=>t.type==="income").reduce((s,t)=>s+(+t.amount||0),0);
  const exp = filtered.filter(t=>t.type==="expense").reduce((s,t)=>s+(+t.amount||0),0);

  const expByCat = EXPENSE_CATS
    .map(c=>({name:c,value:filtered.filter(t=>t.type==="expense"&&t.category===c).reduce((s,t)=>s+(+t.amount||0),0)}))
    .filter(d=>d.value>0);
  const incByCat = INCOME_CATS
    .map(c=>({name:c,value:filtered.filter(t=>t.type==="income"&&t.category===c).reduce((s,t)=>s+(+t.amount||0),0)}))
    .filter(d=>d.value>0);

  const tt = {background:"#141414",border:"1px solid #141414",borderRadius:8,fontSize:12,color:"white"};

  return (
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16,alignItems:"center"}}>
        <div style={{display:"flex",gap:6}}>
          {[["all","Все"],["income","Доходы"],["expense","Расходы"]].map(([v,l])=>(
            <Chip key={v} label={l} active={typeFilter===v} onClick={()=>setTypeFilter(v)}/>
          ))}
        </div>
        <input type="month" value={monthF} onChange={e=>setMonthF(e.target.value)}
          style={{...BASE_INPUT,width:"auto",padding:"4px 12px",fontSize:13}}/>
        <button onClick={()=>setModal("add")} className={BTN.primary} style={{marginLeft:"auto"}}>
          + Добавить запись
        </button>
        <button onClick={()=>setCsvModal(true)} style={{
          fontSize:12,padding:"7px 12px",borderRadius:8,cursor:"pointer",fontWeight:600,
          background:"#6ee7a822",border:"1px solid #6ee7a844",color:"#6ee7a8",flexShrink:0,
        }}>
          📂 Импорт CSV
        </button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
        {[
          {label:"Доходы",val:inc,color:"#e8c860"},
          {label:"Расходы",val:exp,color:"#f8a3a3"},
          {label:"Баланс",val:inc-exp,color:inc>=exp?"#6ee7a8":"#f8a3a3"},
        ].map(r=>(
          <Card key={r.label} style={{textAlign:"center"}}>
            <Label>{r.label}</Label>
            <div style={{fontSize:16,fontWeight:900,color:r.color,marginTop:4}}>{fmt(r.val)}</div>
          </Card>
        ))}
      </div>

      {(incByCat.length>0||expByCat.length>0)&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
          {incByCat.length>0&&(
            <Card>
              <SectionTitle>Источники доходов</SectionTitle>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={incByCat} cx="50%" cy="50%" innerRadius={38} outerRadius={62} dataKey="value" paddingAngle={2}>
                    {incByCat.map((_,i)=><Cell key={i} fill={PALETTE[i%PALETTE.length]} stroke="transparent"/>)}
                  </Pie>
                  <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v,n)=>[fmt(v),n]}/>
                  <Legend iconType="circle" iconSize={7} formatter={v=><span style={{fontSize:10,color:"#a8a8a3"}}>{v}</span>}/>
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}
          {expByCat.length>0&&(
            <Card>
              <SectionTitle>Структура расходов</SectionTitle>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={expByCat} cx="50%" cy="50%" innerRadius={38} outerRadius={62} dataKey="value" paddingAngle={2}>
                    {expByCat.map((_,i)=><Cell key={i} fill={PALETTE[i%PALETTE.length]} stroke="transparent"/>)}
                  </Pie>
                  <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v,n)=>[fmt(v),n]}/>
                  <Legend iconType="circle" iconSize={7} formatter={v=><span style={{fontSize:10,color:"#a8a8a3"}}>{v}</span>}/>
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.length===0
          ? <Empty text="Нет записей за выбранный период"/>
          : filtered.map(t=>(
            <div key={t.id} style={{
              background:"#141414",border:"1px solid #141414",borderRadius:12,
              padding:"12px 16px",display:"flex",alignItems:"center",gap:12,
            }}>
              <div style={{width:4,height:36,borderRadius:2,flexShrink:0,
                background:t.type==="income"?"#d4af37":"#f8a3a3"}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:"#fafaf7",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {t.description||t.category}
                </div>
                <div style={{fontSize:11,color:"#6b6b67",marginTop:2}}>{t.category} · {fmtD(t.date)}</div>
              </div>
              <div style={{fontWeight:700,fontSize:14,flexShrink:0,
                color:t.type==="income"?"#e8c860":"#f8a3a3"}}>
                {t.type==="income"?"+":"−"}{fmt(+t.amount)}
              </div>
              <button onClick={()=>setModal(t)} className={BTN.edit} style={{flexShrink:0}}>✏️</button>
              <button
                onClick={()=>{if(confirmDel===t.id){del(t.id);}else{setConfirmDel(t.id);}}}
                onBlur={()=>setConfirmDel(null)}
                title={confirmDel===t.id?"Нажми ещё раз — удалить":"Удалить запись"}
                style={{
                  padding:"4px 8px",borderRadius:6,border:"none",cursor:"pointer",
                  fontSize:12,fontWeight:700,flexShrink:0,transition:"all .15s",
                  background:confirmDel===t.id?"#f8a3a333":"transparent",
                  color:confirmDel===t.id?"#f8a3a3":"#6b6b67",
                }}
              >{confirmDel===t.id?"✓?":"🗑️"}</button>
            </div>
          ))}
      </div>

      {modal&&(
        <Modal
          title={modal==="add"?"Новая запись":"Редактировать запись"}
          onClose={()=>!saving&&setModal(null)}>
          <TxForm initial={modal==="add"?null:modal} onSave={saveTx} onClose={()=>setModal(null)} saving={saving}/>
        </Modal>
      )}
      {csvModal&&(
        <CsvImportModal
          onClose={()=>setCsvModal(false)}
          onImport={handleCsvImport}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ANALYTICS — без изменений
// ════════════════════════════════════════════════════════════════════════════
function Analytics({ projects, txs }) {
  const now = new Date();
  const byType = PROJECT_TYPES
    .map(type=>({
      name:type,
      count:projects.filter(p=>p.type===type).length,
      contract:projects.filter(p=>p.type===type).reduce((s,p)=>s+(+p.contractSum||0),0),
      paid:projects.filter(p=>p.type===type).reduce((s,p)=>s+(+p.paidAmount||0),0),
    }))
    .filter(d=>d.count>0);

  const months12 = Array.from({length:12},(_,i)=>{
    const d = new Date(now.getFullYear(),now.getMonth()-11+i,1);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const inc = txs.filter(t=>t.type==="income"&&t.date.startsWith(k)).reduce((s,t)=>s+(+t.amount||0),0);
    const exp = txs.filter(t=>t.type==="expense"&&t.date.startsWith(k)).reduce((s,t)=>s+(+t.amount||0),0);
    return {label:d.toLocaleDateString("ru-RU",{month:"short"}),balance:inc-exp};
  });

  const totalContract = projects.filter(p=>p.stage!=="Архив").reduce((s,p)=>s+(+p.contractSum||0),0);
  const totalPaid     = projects.filter(p=>p.stage!=="Архив").reduce((s,p)=>s+(+p.paidAmount||0),0);
  const payRate = totalContract>0 ? Math.round(totalPaid/totalContract*100) : 0;
  const tt = {background:"#141414",border:"1px solid #141414",borderRadius:8,fontSize:12,color:"white"};

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        {[
          {label:"Всего проектов",       value:projects.length,                                  color:"#d4af37"},
          {label:"Завершено и оплачено", value:projects.filter(p=>p.stage==="Оплачен").length,  color:"#6ee7a8"},
          {label:"Оплачено от портфеля", value:`${payRate}%`,                                   color:"#f59e0b"},
        ].map(s=>(
          <Card key={s.label} style={{textAlign:"center"}}>
            <Label>{s.label}</Label>
            <div style={{fontSize:28,fontWeight:900,color:s.color,marginTop:4}}>{s.value}</div>
          </Card>
        ))}
      </div>

      {byType.length>0&&(
        <Card>
          <SectionTitle>Портфель по типам работ</SectionTitle>
          <ResponsiveContainer width="100%" height={Math.max(140,byType.length*46)}>
            <BarChart data={byType} layout="vertical" barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke="#141414" horizontal={false}/>
              <XAxis type="number" tick={{fill:"#6b6b67",fontSize:10}} axisLine={false} tickLine={false}
                tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}к`:v}/>
              <YAxis type="category" dataKey="name" tick={{fill:"#a8a8a3",fontSize:11}} width={165} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v,n)=>[fmt(v),n==="contract"?"Договор":"Оплачено"]}/>
              <Bar dataKey="contract" name="contract" fill="#d4af37" radius={[0,4,4,0]}/>
              <Bar dataKey="paid"     name="paid"     fill="#6ee7a8" radius={[0,4,4,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {months12.some(m=>m.balance!==0)&&(
        <Card>
          <SectionTitle>Баланс по месяцам — 12 мес.</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={months12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#141414" vertical={false}/>
              <XAxis dataKey="label" tick={{fill:"#6b6b67",fontSize:10}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:"#6b6b67",fontSize:10}} axisLine={false} tickLine={false}
                tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}к`:v<=-1000?`-${Math.abs(v/1000).toFixed(0)}к`:v}/>
              <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={v=>[fmt(v),"Баланс"]}/>
              <Line type="monotone" dataKey="balance" stroke="#d4af37" strokeWidth={2.5} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card>
        <SectionTitle>Воронка стадий проектов</SectionTitle>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {PROJECT_STAGES.map(stage=>{
            const count = projects.filter(p=>p.stage===stage).length;
            const maxC  = Math.max(...PROJECT_STAGES.map(s=>projects.filter(p=>p.stage===s).length),1);
            const w = count>0 ? Math.max(6,Math.round(count/maxC*100)) : 0;
            return (
              <div key={stage} style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:160,textAlign:"right",fontSize:12,color:"#a8a8a3",fontWeight:500}}>{stage}</div>
                <div style={{flex:1,height:28,background:"#141414",borderRadius:8,overflow:"hidden"}}>
                  {w>0&&(
                    <div style={{height:"100%",borderRadius:8,display:"flex",alignItems:"center",
                      justifyContent:"flex-end",paddingRight:10,fontSize:12,fontWeight:700,color:"white",
                      width:`${w}%`,background:STAGE_META[stage]?.color||"#d4af37"}}>
                      {count}
                    </div>
                  )}
                </div>
                <div style={{width:20,textAlign:"center",fontSize:11,color:"#404040"}}>{count}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "48px 0",
      color: "#62646b",
    }}>
      <div style={{
        width: 48, height: 48,
        borderRadius: 12,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 12,
      }}>
        <Inbox size={22} strokeWidth={1.6} style={{ color: "#62646b" }} />
      </div>
      <p style={{ fontSize: 13, margin: 0, color: "#9b9ca4" }}>{text}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// v1.5: ВСПОМОГАТЕЛЬНЫЕ ХУКИ И КОМПОНЕНТЫ
// ════════════════════════════════════════════════════════════════════════════

// Хук определения роли текущего пользователя на конкретном проекте.
// Возвращает один из: "owner" | "admin" | "editor" | "viewer" | "none"
function useProjectRole(project, profile, projectMembers) {
  if (!project || !profile) return "none";
  if (project.ownerId === profile.id) return "owner";
  if (profile.role === "admin") return "admin";
  const m = (projectMembers || []).find(pm => pm.user_id === profile.id);
  if (m) return m.member_role === "editor" ? "editor" : "viewer";
  if (project.visibility === "team") return "viewer";
  return "none";
}

// Бейдж роли пользователя на проекте — отображается в правом верхнем углу карточки
function PermissionBadge({ role }) {
  const config = {
    owner:       { label: "Мой",                Icon: Crown,       color: "#d4af37", bg: "rgba(212,175,55,0.12)",  border: "rgba(212,175,55,0.30)"  },
    admin:       { label: "Admin",              Icon: ShieldCheck, color: "#d4af37", bg: "rgba(212,175,55,0.12)",  border: "rgba(212,175,55,0.30)"  },
    editor:      { label: "Команда · редактор", Icon: PencilLine,  color: "#6ee7a8", bg: "rgba(110,231,168,0.10)", border: "rgba(110,231,168,0.25)" },
    viewer:      { label: "Команда",            Icon: Users,       color: "#93c5fd", bg: "rgba(147,197,253,0.10)", border: "rgba(147,197,253,0.25)" },
    marketplace: { label: "Маркетплейс",        Icon: Store,       color: "#93c5fd", bg: "rgba(147,197,253,0.08)", border: "rgba(147,197,253,0.22)" },
    selected:    { label: "Приглашён",          Icon: Eye,         color: "#f3d77b", bg: "rgba(243,215,123,0.08)", border: "rgba(243,215,123,0.22)" },
  };
  const c = config[role];
  if (!c) return null;
  const { label, Icon, color, bg, border } = c;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 6,
      background: bg, border: `1px solid ${border}`,
      color, fontSize: 10, fontWeight: 600,
      letterSpacing: "0.04em",
      whiteSpace: "nowrap",
    }}>
      <Icon size={10} strokeWidth={2.4} />
      {label}
    </span>
  );
}

// Аватар-инициалы для отображения участника команды
function UserAvatar({ name, email, size = 28 }) {
  const initials = (name || email || "?").trim()
    .split(/\s+/).slice(0, 2).map(s => s[0] || "").join("").toUpperCase() || "?";
  return (
    <span
      title={name || email}
      style={{
        width: size, height: size, borderRadius: "50%",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "rgba(212,175,55,0.10)",
        border: "1px solid rgba(212,175,55,0.30)",
        color: "#d4af37",
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >{initials}</span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// COMMENTS SECTION — секция комментариев в форме проекта (v2.0)
// ════════════════════════════════════════════════════════════════════════════
function CommentsSection({ projectId, profile, client, showToast, isOwner }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [text, setText]         = useState("");
  const [sending, setSending]   = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const reload = async () => {
    if (!projectId || !client) return;
    setLoading(true);
    try {
      const list = await fetchProjectComments(client, projectId);
      setComments(list);
    } catch (e) {
      showToast("Ошибка загрузки комментариев: " + (e.message || ""), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [projectId]); // eslint-disable-line

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const trimmed = text.trim();
      await insertProjectComment(client, projectId, trimmed);
      setText("");
      await reload();
      // Уведомление всем участникам проекта (best-effort, через Edge Function)
      sendPush(client, "comment", null, {
        projectId,
        commentText: trimmed,
        actorName: profile?.name || profile?.email,
        actorId: profile?.id,
      });
    } catch (e) {
      showToast("Ошибка: " + (e.message || "не удалось отправить"), "error");
    } finally {
      setSending(false);
    }
  };

  const resolve = async (commentId, val) => {
    try {
      await resolveProjectComment(client, commentId, val);
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, resolved: val, resolvedAt: val ? new Date().toISOString() : null } : c
      ));
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    }
  };

  const remove = async (commentId) => {
    try {
      await deleteProjectComment(client, commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
      showToast("Комментарий удалён");
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    }
  };

  const open     = comments.filter(c => !c.resolved);
  const resolved = comments.filter(c =>  c.resolved);

  const CommentCard = ({ c }) => {
    const isMe    = c.authorId === profile?.id;
    const canDel  = isMe || profile?.role === "admin";
    const canRes  = isMe || isOwner || profile?.role === "admin";
    return (
      <div style={{
        display: "flex", gap: 10, padding: "10px 0",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        opacity: c.resolved ? 0.5 : 1,
        transition: "opacity 0.2s",
      }}>
        <UserAvatar name={c.authorName} email={c.authorEmail} size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#fafaf7" }}>
              {c.authorName}
            </span>
            <span style={{ fontSize: 10, color: "#6b6b67" }}>{fmtDT(c.createdAt)}</span>
            {c.resolved && (
              <span style={{
                fontSize: 10, fontWeight: 600, color: "#6ee7a8",
                padding: "1px 6px", borderRadius: 4,
                background: "rgba(110,231,168,0.08)",
                border: "1px solid rgba(110,231,168,0.20)",
              }}>✓ Решено</span>
            )}
          </div>
          <p style={{
            margin: 0, fontSize: 13, color: "#a8a8a3",
            lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{c.content}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {canRes && !c.resolved && (
              <button onClick={() => resolve(c.id, true)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 11, color: "#6ee7a8", padding: 0,
                textDecoration: "underline", textUnderlineOffset: 2,
              }}>✓ Отметить как решённое</button>
            )}
            {canRes && c.resolved && (
              <button onClick={() => resolve(c.id, false)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 11, color: "#6b6b67", padding: 0,
                textDecoration: "underline", textUnderlineOffset: 2,
              }}>↩ Переоткрыть</button>
            )}
            {canDel && (
              <button onClick={() => remove(c.id)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 11, color: "#f8a3a3", padding: 0,
                textDecoration: "underline", textUnderlineOffset: 2,
              }}>Удалить</button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Список открытых комментариев */}
      {loading ? (
        <p style={{ fontSize: 12, color: "#6b6b67", margin: "0 0 10px" }}>Загрузка…</p>
      ) : open.length === 0 ? (
        <p style={{ fontSize: 12, color: "#6b6b67", margin: "0 0 10px" }}>Пока нет комментариев</p>
      ) : (
        <div style={{ marginBottom: 4 }}>
          {open.map(c => <CommentCard key={c.id} c={c} />)}
        </div>
      )}

      {/* Ввод нового комментария */}
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
          placeholder="Добавить комментарий… (Ctrl+Enter для отправки)"
          rows={2}
          style={{
            flex: 1, background: "#0a0a0a",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 8, padding: "8px 10px",
            color: "#fafaf7", fontSize: 13, resize: "none",
            fontFamily: "inherit", lineHeight: 1.5,
            WebkitTextFillColor: "#fafaf7",
          }}
        />
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          style={{
            padding: "8px 14px", borderRadius: 8,
            background: text.trim() ? "#d4af37" : "rgba(212,175,55,0.20)",
            border: "none", cursor: text.trim() ? "pointer" : "default",
            color: text.trim() ? "#0a0a0a" : "#6b6b67",
            fontSize: 12, fontWeight: 700,
            transition: "all 0.15s", whiteSpace: "nowrap",
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? "…" : "Отправить"}
        </button>
      </div>
      <p style={{ fontSize: 10, color: "#404040", margin: "4px 0 0" }}>Ctrl+Enter — отправить</p>

      {/* Аккордеон решённых комментариев */}
      {resolved.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowResolved(v => !v)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#6b6b67", fontSize: 11, padding: 0,
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <ChevronDown
              size={12} strokeWidth={2.4}
              style={{ transform: showResolved ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
            />
            Решённые ({resolved.length})
          </button>
          {showResolved && (
            <div style={{ marginTop: 6, opacity: 0.7 }}>
              {resolved.map(c => <CommentCard key={c.id} c={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECT FILES — файловое хранилище проекта через Yandex Disk (v2.0)
// ════════════════════════════════════════════════════════════════════════════

// Иконка файла по MIME-типу
function FileTypeIcon({ mimeType }) {
  const m = mimeType || "";
  if (m.startsWith("image/"))
    return <FileImage size={14} strokeWidth={2} style={{ color: "#93c5fd" }} />;
  if (m === "application/pdf")
    return <FileText size={14} strokeWidth={2} style={{ color: "#f8a3a3" }} />;
  return <FileText size={14} strokeWidth={2} style={{ color: "#a8a8a3" }} />;
}

function ProjectFiles({ projectId, profile, client, showToast, isOwner }) {
  const [files, setFiles]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadPublic, setUploadPublic] = useState(false);
  const [usedBytes, setUsedBytes] = useState(0);
  const fileInputRef = useRef(null);

  const MAX_PROJ_BYTES = 100 * 1024 * 1024; // 100 МБ
  const usedPct = Math.min(100, (usedBytes / MAX_PROJ_BYTES) * 100);

  const reload = async () => {
    if (!projectId || !client) return;
    setLoading(true);
    try {
      const list = await fetchProjectFiles(client, projectId);
      setFiles(list);
      setUsedBytes(list.reduce((s, f) => s + (f.file_size || 0), 0));
    } catch (e) {
      showToast("Ошибка загрузки файлов: " + (e.message || ""), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [projectId]); // eslint-disable-line

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      showToast("Файл слишком большой: максимум 20 МБ", "error");
      return;
    }
    setUploading(true);
    try {
      await uploadProjectFile(client, projectId, file, uploadPublic);
      showToast("✓ Файл загружен");
      await reload();
    } catch (e) {
      showToast("Ошибка загрузки: " + (e.message || ""), "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownload = async (f) => {
    try {
      showToast("Скачиваем…");
      const blob = await downloadProjectFile(client, f.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    }
  };

  const handleTogglePublic = async (f) => {
    try {
      await toggleFilePublic(client, f.id, !f.is_public);
      setFiles(prev => prev.map(x =>
        x.id === f.id ? { ...x, is_public: !f.is_public, public_url: null } : x
      ));
      showToast(f.is_public ? "Файл сделан приватным" : "Файл опубликован (доступ внутри системы)");
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    }
  };

  const handleDelete = async (f) => {
    try {
      await deleteProjectFile(client, f.id);
      setFiles(prev => prev.filter(x => x.id !== f.id));
      setUsedBytes(prev => Math.max(0, prev - (f.file_size || 0)));
      showToast("Файл удалён");
    } catch (e) {
      showToast("Ошибка удаления: " + (e.message || ""), "error");
    }
  };

  const canDelete = (f) =>
    f.owner_id === profile?.id
    || isOwner
    || profile?.role === "admin";

  return (
    <div>
      {/* Шкала использования хранилища */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6b6b67", marginBottom: 4 }}>
          <span>Использовано: {fmtSize(usedBytes)}</span>
          <span>Лимит: 100 МБ</span>
        </div>
        <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 2, transition: "width 0.4s",
            width: `${usedPct}%`,
            background: usedPct > 85 ? "#f8a3a3" : usedPct > 60 ? "#f3d77b" : "#6ee7a8",
          }} />
        </div>
      </div>

      {/* Список файлов */}
      {loading ? (
        <p style={{ fontSize: 12, color: "#6b6b67", margin: "0 0 8px" }}>Загрузка…</p>
      ) : files.length === 0 ? (
        <p style={{ fontSize: 12, color: "#6b6b67", margin: "0 0 8px" }}>Файлов пока нет</p>
      ) : (
        <div style={{ marginBottom: 8 }}>
          {files.map(f => (
            <div key={f.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}>
              <FileTypeIcon mimeType={f.mime_type} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 500, color: "#fafaf7",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{f.filename}</div>
                <div style={{ fontSize: 10, color: "#6b6b67", marginTop: 1 }}>
                  {fmtSize(f.file_size)} · {fmtDT(f.created_at)} · {f.uploader_name}
                  {f.is_public && (
                    <span style={{ marginLeft: 6, color: "#6ee7a8" }}>● публичный</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {/* Скачать */}
                <button
                  onClick={() => handleDownload(f)}
                  title="Открыть / скачать"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#a8a8a3", padding: 4, lineHeight: 1,
                    transition: "color 0.15s",
                  }}
                  onMouseOver={e => e.currentTarget.style.color = "#d4af37"}
                  onMouseOut={e => e.currentTarget.style.color = "#a8a8a3"}
                >
                  <Download size={13} strokeWidth={2.2} />
                </button>
                {/* Публичность (только загрузивший или владелец) */}
                {(f.owner_id === profile?.id || isOwner || profile?.role === "admin") && (
                  <button
                    onClick={() => handleTogglePublic(f)}
                    title={f.is_public ? "Сделать приватным" : "Опубликовать"}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: f.is_public ? "#6ee7a8" : "#6b6b67", padding: 4, lineHeight: 1,
                      transition: "color 0.15s",
                    }}
                    onMouseOver={e => e.currentTarget.style.color = "#d4af37"}
                    onMouseOut={e => e.currentTarget.style.color = f.is_public ? "#6ee7a8" : "#6b6b67"}
                  >
                    {f.is_public
                      ? <Unlock size={13} strokeWidth={2.2} />
                      : <Lock size={13} strokeWidth={2.2} />
                    }
                  </button>
                )}
                {/* Удалить */}
                {canDelete(f) && (
                  <button
                    onClick={() => handleDelete(f)}
                    title="Удалить файл"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "#6b6b67", padding: 4, lineHeight: 1,
                      transition: "color 0.15s",
                    }}
                    onMouseOver={e => e.currentTarget.style.color = "#f8a3a3"}
                    onMouseOut={e => e.currentTarget.style.color = "#6b6b67"}
                  >
                    <Trash2 size={13} strokeWidth={2.2} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Кнопка загрузки + переключатель публичности */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || usedBytes >= MAX_PROJ_BYTES}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8,
            background: "rgba(212,175,55,0.08)",
            border: "1px solid rgba(212,175,55,0.25)",
            color: "#d4af37", fontSize: 12, fontWeight: 600,
            cursor: uploading || usedBytes >= MAX_PROJ_BYTES ? "default" : "pointer",
            opacity: uploading || usedBytes >= MAX_PROJ_BYTES ? 0.5 : 1,
            transition: "all 0.15s",
          }}
        >
          <Paperclip size={12} strokeWidth={2.4} />
          {uploading ? "Загрузка…" : "Прикрепить файл"}
        </button>
        {/* Переключатель приватности для следующей загрузки */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={uploadPublic}
            onChange={e => setUploadPublic(e.target.checked)}
            style={{ accentColor: "#d4af37" }}
          />
          <span style={{ fontSize: 11, color: "#6b6b67" }}>Публичный</span>
        </label>
        <span style={{ fontSize: 10, color: "#404040", marginLeft: "auto" }}>макс. 20 МБ</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENT SELECTOR — выпадающий выбор клиента в форме проекта (v1.5)
// ════════════════════════════════════════════════════════════════════════════
// Гибридная логика: позволяет либо выбрать существующего клиента из базы
// (при этом контакты автозаполняются), либо ввести имя вручную как раньше.
function ClientSelector({ value, clientId, onSelect, onClear, client, onClientPicked }) {
  const [query, setQuery] = useState(value || "");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => { setQuery(value || ""); }, [value]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const loadSuggestions = async (q) => {
    setLoading(true);
    try {
      const list = await searchClientsByQuery(client, q);
      setSuggestions(list);
    } catch {
      setSuggestions([]);
    }
    setLoading(false);
  };

  const handleChange = (v) => {
    setQuery(v);
    onSelect(v);
    if (clientId) onClear();
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      loadSuggestions(v);
      setOpen(true);
    }, 200);
  };

  const pickSuggestion = (s) => {
    setQuery(s.name);
    onSelect(s.name);
    onClientPicked(s);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <StyledInput
        value={query}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => { if (query.length === 0) loadSuggestions(""); setOpen(true); }}
        placeholder="Имя или название организации"
        style={clientId ? {
          paddingRight: 32,
          borderColor: "#d4af37",
          boxShadow: "0 0 0 3px rgba(212,175,55,0.18)",
        } : {}}
      />
      {clientId && (
        <span
          title="Привязан к клиенту из базы"
          style={{
            position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
            color: "#d4af37", display: "flex", alignItems: "center",
            pointerEvents: "none",
          }}
        >
          <BadgeCheck size={14} strokeWidth={2.2} />
        </span>
      )}
      {open && suggestions.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#1c1c1a",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 10,
          boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
          zIndex: 50,
          maxHeight: 240,
          overflowY: "auto",
        }}>
          {suggestions.map(s => (
            <div
              key={s.id}
              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                display: "flex", alignItems: "center", gap: 10,
                transition: "background 0.15s",
              }}
              onMouseOver={e => e.currentTarget.style.background = "rgba(212,175,55,0.06)"}
              onMouseOut={e => e.currentTarget.style.background = "transparent"}
            >
              <UserAvatar name={s.name} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#fafaf7", fontWeight: 500 }}>{s.name}</div>
                {(s.legal_name || s.phone || s.email) && (
                  <div style={{ fontSize: 11, color: "#a8a8a3", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.legal_name && <span>{s.legal_name}</span>}
                    {s.legal_name && (s.phone || s.email) && <span style={{ margin: "0 6px", color: "#404040" }}>·</span>}
                    {s.phone && <span>{s.phone}</span>}
                    {s.phone && s.email && <span style={{ margin: "0 6px", color: "#404040" }}>·</span>}
                    {s.email && <span>{s.email}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MEMBERS MANAGER — секция управления командой проекта (v1.5)
// ════════════════════════════════════════════════════════════════════════════
function MembersManager({ projectId, profile, client, showToast, canManage }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedRole, setSelectedRole] = useState("editor");
  const [selectedUser, setSelectedUser] = useState(null);

  const reload = async () => {
    if (!projectId) { setMembers([]); setLoading(false); return; }
    setLoading(true);
    try {
      const list = await fetchProjectMembers(client, projectId);
      setMembers(list);
    } catch (e) {
      showToast("Не удалось загрузить команду: " + (e.message || ""), "error");
    }
    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [projectId]);

  const doSearch = async (q) => {
    setSearchQuery(q);
    if (!q || q.length < 2) { setSearchResults([]); return; }
    try {
      const list = await searchApprovedUsers(client, q);
      const memberIds = new Set(members.map(m => m.user_id));
      setSearchResults(list.filter(u => !memberIds.has(u.id)));
    } catch {
      setSearchResults([]);
    }
  };

  const doInvite = async () => {
    if (!selectedUser) return;
    try {
      await addProjectMember(client, projectId, selectedUser.id, selectedRole);
      showToast(`✓ ${selectedUser.name || selectedUser.email} приглашён(а)`);
      // Уведомление приглашённому пользователю
      sendPush(client, "team_invite", selectedUser.id, {
        projectName: "(проект)",
        actorName: profile?.name || profile?.email,
      });
      setSelectedUser(null);
      setSearchQuery("");
      setSearchResults([]);
      setAdding(false);
      reload();
    } catch (e) {
      showToast("Ошибка приглашения: " + (e.message || ""), "error");
    }
  };

  const doRemove = async (userId) => {
    try {
      await removeProjectMember(client, projectId, userId);
      showToast("Участник удалён");
      reload();
    } catch (e) {
      showToast("Ошибка удаления: " + (e.message || ""), "error");
    }
  };

  const doChangeRole = async (userId, newRole) => {
    try {
      await updateProjectMemberRole(client, projectId, userId, newRole);
      reload();
    } catch (e) {
      showToast("Ошибка смены роли: " + (e.message || ""), "error");
    }
  };

  if (!projectId) {
    return (
      <div style={{ fontSize: 11, color: "#6b6b67", fontStyle: "italic", textAlign: "center", padding: "12px 0" }}>
        Команду можно настроить после первого сохранения проекта
      </div>
    );
  }

  return (
    <div>
      {loading ? (
        <div style={{ fontSize: 11, color: "#6b6b67", textAlign: "center", padding: "10px 0" }}>Загружаем...</div>
      ) : members.length === 0 && !adding ? (
        <div style={{ fontSize: 11, color: "#6b6b67", textAlign: "center", padding: "8px 0", fontStyle: "italic" }}>
          В проекте пока только владелец
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {members.map(m => (
            <div key={m.user_id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: 8,
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              <UserAvatar name={m.name} email={m.email} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "#fafaf7", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name || m.email.split("@")[0]}
                </div>
                <div style={{ fontSize: 10, color: "#6b6b67", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.email}
                </div>
              </div>
              {canManage ? (
                <>
                  <select
                    value={m.member_role}
                    onChange={e => doChangeRole(m.user_id, e.target.value)}
                    style={{
                      ...BASE_INPUT, width: "auto", padding: "3px 6px",
                      fontSize: 10, fontWeight: 600,
                    }}
                  >
                    <option value="viewer">Просмотр</option>
                    <option value="editor">Редактор</option>
                  </select>
                  <button
                    onClick={() => doRemove(m.user_id)}
                    style={{
                      background: "transparent", border: "none", color: "#6b6b67",
                      cursor: "pointer", padding: 4, display: "flex",
                    }}
                    onMouseOver={e => e.currentTarget.style.color = "#f8a3a3"}
                    onMouseOut={e => e.currentTarget.style.color = "#6b6b67"}
                    title="Удалить из команды"
                  >
                    <UserMinus size={14} strokeWidth={2.2} />
                  </button>
                </>
              ) : (
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  padding: "2px 8px", borderRadius: 5,
                  background: m.member_role === "editor" ? "rgba(110,231,168,0.10)" : "rgba(147,197,253,0.10)",
                  color: m.member_role === "editor" ? "#6ee7a8" : "#93c5fd",
                  border: `1px solid ${m.member_role === "editor" ? "rgba(110,231,168,0.25)" : "rgba(147,197,253,0.25)"}`,
                }}>
                  {m.member_role === "editor" ? "Редактор" : "Просмотр"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {canManage && (
        <>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              style={{
                fontSize: 11, padding: "5px 12px", borderRadius: 7,
                background: "rgba(212,175,55,0.12)",
                border: "1px solid rgba(212,175,55,0.30)",
                color: "#d4af37", cursor: "pointer", fontWeight: 500,
                display: "inline-flex", alignItems: "center", gap: 5,
                fontFamily: "inherit",
              }}
            >
              <UserPlus size={11} strokeWidth={2.4} /> Пригласить
            </button>
          ) : (
            <div style={{
              padding: 10, borderRadius: 8,
              background: "rgba(212,175,55,0.04)",
              border: "1px solid rgba(212,175,55,0.20)",
            }}>
              <StyledInput
                value={searchQuery}
                onChange={e => doSearch(e.target.value)}
                placeholder="Поиск по email или имени..."
                style={{ fontSize: 12, padding: "6px 10px", marginBottom: 8 }}
                autoFocus
              />
              {searchResults.length > 0 && (
                <div style={{ marginBottom: 8, maxHeight: 180, overflowY: "auto", borderRadius: 6, background: "rgba(0,0,0,0.20)" }}>
                  {searchResults.map(u => (
                    <div
                      key={u.id}
                      onClick={() => setSelectedUser(u)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 10px", cursor: "pointer",
                        background: selectedUser?.id === u.id ? "rgba(212,175,55,0.12)" : "transparent",
                        transition: "background 0.15s",
                      }}
                    >
                      <UserAvatar name={u.name} email={u.email} size={22} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: "#fafaf7" }}>{u.name || u.email.split("@")[0]}</div>
                        <div style={{ fontSize: 10, color: "#6b6b67" }}>{u.email}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selectedUser && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: "#a8a8a3" }}>Роль:</span>
                  {["viewer", "editor"].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelectedRole(r)}
                      style={{
                        padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: 600,
                        background: selectedRole === r ? "rgba(212,175,55,0.20)" : "transparent",
                        border: `1px solid ${selectedRole === r ? "rgba(212,175,55,0.40)" : "rgba(255,255,255,0.10)"}`,
                        color: selectedRole === r ? "#d4af37" : "#a8a8a3",
                        fontFamily: "inherit",
                      }}
                    >
                      {r === "viewer" ? "Просмотр" : "Редактор"}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => { setAdding(false); setSelectedUser(null); setSearchQuery(""); setSearchResults([]); }}
                  style={{
                    flex: 1, padding: "5px 10px", borderRadius: 6,
                    background: "transparent", border: "1px solid rgba(255,255,255,0.10)",
                    color: "#a8a8a3", cursor: "pointer", fontSize: 11, fontFamily: "inherit",
                  }}
                >Отмена</button>
                <button
                  type="button"
                  onClick={doInvite}
                  disabled={!selectedUser}
                  style={{
                    flex: 1, padding: "5px 10px", borderRadius: 6,
                    background: selectedUser ? "#d4af37" : "rgba(212,175,55,0.20)",
                    border: "none", color: "#0a0a0a",
                    cursor: selectedUser ? "pointer" : "default",
                    fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                    opacity: selectedUser ? 1 : 0.5,
                  }}
                >Пригласить</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENT FORM — форма создания/редактирования клиента (v1.5)
// ════════════════════════════════════════════════════════════════════════════
function ClientForm({ initial, onSave, onClose, saving }) {
  const [f, setF] = useState(initial || {
    name: "", phone: "", email: "", telegram: "",
    clientType: "individual", category: "regular",
    legalName: "", inn: "", address: "", city: "", notes: "",
  });
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <div>
      <Field label="Имя клиента *">
        <StyledInput value={f.name} onChange={e => s("name", e.target.value)}
          placeholder="ФИО или название организации" autoFocus />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <Label>Тип клиента</Label>
          <StyledSelect value={f.clientType} onChange={e => s("clientType", e.target.value)}>
            <option value="individual">Физлицо</option>
            <option value="legal">Юрлицо</option>
            <option value="state">Госучреждение</option>
          </StyledSelect>
        </div>
        <div>
          <Label>Категория</Label>
          <StyledSelect value={f.category} onChange={e => s("category", e.target.value)}>
            <option value="regular">Постоянный</option>
            <option value="one-time">Разовый</option>
            <option value="potential">Потенциальный</option>
            <option value="archived">Архив</option>
          </StyledSelect>
        </div>
      </div>

      {/* Основные контакты */}
      <div style={{
        marginBottom: 14, padding: "12px 14px",
        background: "rgba(212,175,55,0.04)",
        border: "1px solid rgba(212,175,55,0.12)",
        borderRadius: 10,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 600, color: "#d4af37",
          textTransform: "uppercase", letterSpacing: "0.10em",
          marginBottom: 12,
        }}>
          <PhoneIcon size={12} strokeWidth={2.4} /> Контакты
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <Label>Телефон</Label>
            <StyledInput type="tel" value={f.phone} onChange={e => s("phone", e.target.value)} placeholder="+7 999 123-45-67" />
          </div>
          <div>
            <Label>Email</Label>
            <StyledInput type="email" value={f.email} onChange={e => s("email", e.target.value)} placeholder="client@example.com" />
          </div>
        </div>
        <div>
          <Label>Telegram (без @)</Label>
          <StyledInput value={f.telegram} onChange={e => s("telegram", e.target.value)} placeholder="username" />
        </div>
      </div>

      {/* Юридические реквизиты — все опциональны */}
      <div style={{
        marginBottom: 14, padding: "12px 14px",
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 600, color: "#a8a8a3",
          textTransform: "uppercase", letterSpacing: "0.10em",
          marginBottom: 12,
        }}>
          <Building2 size={12} strokeWidth={2.4} /> Реквизиты <span style={{ color: "#6b6b67", fontWeight: 400 }}>(необязательно)</span>
        </div>
        <Field label="Юридическое название">
          <StyledInput value={f.legalName} onChange={e => s("legalName", e.target.value)}
            placeholder='ООО "Стройинвест"' />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <Label>ИНН</Label>
            <StyledInput value={f.inn} onChange={e => s("inn", e.target.value)} placeholder="7700000000" />
          </div>
          <div>
            <Label>Город</Label>
            <StyledInput value={f.city} onChange={e => s("city", e.target.value)} placeholder="Москва" />
          </div>
        </div>
        <Field label="Адрес">
          <StyledInput value={f.address} onChange={e => s("address", e.target.value)} placeholder="ул. ..., д. ..." />
        </Field>
      </div>

      <Field label="Заметки">
        <StyledTextarea rows={2} value={f.notes} onChange={e => s("notes", e.target.value)} placeholder="Особенности работы, важные детали..." />
      </Field>

      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button onClick={onClose} className={BTN.ghost} style={{ flex: 1 }} disabled={saving}>Отмена</button>
        <button onClick={() => onSave(f)} className={BTN.primary} style={{ flex: 2, opacity: saving ? 0.6 : 1 }} disabled={saving}>
          {saving ? "Сохраняем..." : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CLIENTS PAGE — вкладка "Заказчики" (v1.5)
// ════════════════════════════════════════════════════════════════════════════
function ClientsPage({ clients, setClients, projects, client, ownerId, showToast }) {
  const isMobile = useIsMobile();
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [confirmDel, setConfirmDel] = useState(null);
  const [saving, setSaving] = useState(false);

  const saveClient = async (form) => {
    setSaving(true);
    try {
      if (modal === "add") {
        const created = await insertClient(client, form, ownerId);
        setClients(prev => [created, ...prev].sort((a, b) => a.name.localeCompare(b.name, "ru")));
        showToast("✓ Клиент добавлен");
      } else {
        const updated = await updateClient(client, modal.id, form, ownerId);
        setClients(prev => prev.map(c => c.id === updated.id ? updated : c)
          .sort((a, b) => a.name.localeCompare(b.name, "ru")));
        showToast("✓ Клиент обновлён");
      }
      setModal(null);
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    try {
      await deleteClientDb(client, id);
      setClients(prev => prev.filter(c => c.id !== id));
      showToast("Клиент удалён");
    } catch (e) {
      showToast("Ошибка удаления: " + (e.message || ""), "error");
    } finally {
      setConfirmDel(null);
    }
  };

  // Подсчёт статистики по каждому клиенту через присоединение projects
  const clientsWithStats = clients.map(c => {
    const clientProjects = projects.filter(p => p.clientId === c.id);
    return {
      ...c,
      projectsCount: clientProjects.length,
      activeCount: clientProjects.filter(p => !["Оплачен", "Архив"].includes(p.stage)).length,
      totalSum: clientProjects.reduce((s, p) => s + (+p.contractSum || 0), 0),
      totalPaid: clientProjects.reduce((s, p) => s + (+p.paidAmount || 0), 0),
    };
  });

  const visible = clientsWithStats
    .filter(c => filterType === "all" || c.clientType === filterType)
    .filter(c => !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.legalName || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || "").includes(search) ||
      (c.email || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: isMobile ? 0 : 200, maxWidth: 360 }}>
          <Search size={14} strokeWidth={2.2} style={{
            position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
            color: "#6b6b67", pointerEvents: "none",
          }} />
          <StyledInput
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени, реквизитам, контактам..."
            style={{ paddingLeft: 36 }}
          />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[
            ["all", "Все"], ["individual", "Физлица"], ["legal", "Юрлица"], ["state", "Гос."],
          ].map(([v, l]) => (
            <Chip key={v} label={l} active={filterType === v} onClick={() => setFilterType(v)} />
          ))}
        </div>
        <button onClick={() => setModal("add")} className={BTN.primary} style={{ marginLeft: "auto" }}>
          + Новый клиент
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.length === 0 ? (
          <Empty text={
            clients.length === 0
              ? "Пока нет клиентов — нажми «Новый клиент»"
              : "Никто не подходит под фильтр"
          } />
        ) : visible.map(c => (
          <div key={c.id} style={{
            background: "#141414",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14, padding: 16,
            transition: "border-color 0.18s",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <UserAvatar name={c.name} size={42} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ color: "#fafaf7", fontWeight: 600, fontSize: 15 }}>{c.name}</span>
                  {c.clientType === "legal" && (
                    <span style={{
                      fontSize: 10, padding: "1px 7px", borderRadius: 5, fontWeight: 600,
                      background: "rgba(147,197,253,0.10)", color: "#93c5fd",
                      border: "1px solid rgba(147,197,253,0.25)",
                    }}>ЮРЛИЦО</span>
                  )}
                  {c.clientType === "state" && (
                    <span style={{
                      fontSize: 10, padding: "1px 7px", borderRadius: 5, fontWeight: 600,
                      background: "rgba(212,175,55,0.10)", color: "#d4af37",
                      border: "1px solid rgba(212,175,55,0.25)",
                    }}>ГОС.</span>
                  )}
                  {c.category === "potential" && (
                    <span style={{ fontSize: 10, color: "#f3d77b", fontWeight: 600 }}>· Потенциальный</span>
                  )}
                  {c.category === "archived" && (
                    <span style={{ fontSize: 10, color: "#6b6b67", fontWeight: 600 }}>· Архив</span>
                  )}
                </div>
                {c.legalName && (
                  <div style={{ fontSize: 12, color: "#a8a8a3", marginBottom: 6 }}>{c.legalName}</div>
                )}
                {(c.city || c.address) && (
                  <div style={{ fontSize: 11, color: "#6b6b67", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                    <MapPin size={11} strokeWidth={2.2} />
                    {[c.city, c.address].filter(Boolean).join(", ")}
                  </div>
                )}

                {/* Контакты */}
                {(c.phone || c.email || c.telegram) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {c.phone && (
                      <a href={`tel:${c.phone.replace(/\s+/g, "")}`}
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "4px 10px", borderRadius: 6,
                          background: "rgba(212,175,55,0.06)",
                          border: "1px solid rgba(212,175,55,0.20)",
                          color: "#d4af37", fontSize: 11, fontWeight: 500,
                          textDecoration: "none",
                        }}>
                        <Phone size={11} strokeWidth={2.2} /> {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`}
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "4px 10px", borderRadius: 6,
                          background: "rgba(212,175,55,0.06)",
                          border: "1px solid rgba(212,175,55,0.20)",
                          color: "#d4af37", fontSize: 11, fontWeight: 500,
                          textDecoration: "none",
                        }}>
                        <Mail size={11} strokeWidth={2.2} /> {c.email}
                      </a>
                    )}
                    {c.telegram && (
                      <a href={`https://t.me/${c.telegram.replace(/^@/, "")}`}
                        target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "4px 10px", borderRadius: 6,
                          background: "rgba(212,175,55,0.06)",
                          border: "1px solid rgba(212,175,55,0.20)",
                          color: "#d4af37", fontSize: 11, fontWeight: 500,
                          textDecoration: "none",
                        }}>
                        <Send size={11} strokeWidth={2.2} /> @{c.telegram.replace(/^@/, "")}
                      </a>
                    )}
                  </div>
                )}

                {/* Статистика */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 11, color: "#a8a8a3" }}>
                  <span>Проектов: <span style={{ color: "#fafaf7", fontWeight: 600 }}>{c.projectsCount}</span></span>
                  {c.activeCount > 0 && (
                    <span>Активных: <span style={{ color: "#d4af37", fontWeight: 600 }}>{c.activeCount}</span></span>
                  )}
                  {c.totalSum > 0 && (
                    <span>Сумма договоров: <span style={{ color: "#fafaf7", fontWeight: 600 }}>{fmt(c.totalSum)}</span></span>
                  )}
                  {c.totalPaid > 0 && (
                    <span>Оплачено: <span style={{ color: "#6ee7a8", fontWeight: 600 }}>{fmt(c.totalPaid)}</span></span>
                  )}
                </div>

                {c.notes && (
                  <div style={{ fontSize: 11, color: "#6b6b67", fontStyle: "italic", marginTop: 8 }}>{c.notes}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button onClick={() => setModal(c)} className={BTN.edit} title="Редактировать">
                  <Pencil size={14} strokeWidth={2.2} />
                </button>
                <button
                  onClick={() => { if (confirmDel === c.id) { del(c.id); } else { setConfirmDel(c.id); } }}
                  onBlur={() => setConfirmDel(null)}
                  title={confirmDel === c.id ? "Нажми ещё раз чтобы удалить" : "Удалить клиента"}
                  style={{
                    padding: "4px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                    fontSize: 12, fontWeight: 700, transition: "all .15s",
                    background: confirmDel === c.id ? "rgba(248,163,163,0.20)" : "transparent",
                    color: confirmDel === c.id ? "#f8a3a3" : "#6b6b67",
                  }}
                >
                  {confirmDel === c.id ? <Check size={14} strokeWidth={2.4} /> : <Trash2 size={14} strokeWidth={2.2} />}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <Modal
          title={modal === "add" ? "Новый клиент" : "Редактировать клиента"}
          onClose={() => !saving && setModal(null)}
          icon={<BookUser size={16} />}
          maxWidth={560}
        >
          <ClientForm
            initial={modal === "add" ? null : modal}
            onSave={saveClient}
            onClose={() => setModal(null)}
            saving={saving}
          />
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROFILE MODAL — настройки своего профиля (v1.5)
// ════════════════════════════════════════════════════════════════════════════
function ProfileModal({ profile, client, onClose, onProfileUpdated, showToast }) {
  const [name, setSaveName]      = useState(profile?.name || "");
  const [saving, setSaving]      = useState(false);

  // Telegram state
  const [linkCode, setLinkCode]  = useState(null);
  const [genLoading, setGenLoad] = useState(false);
  const [unlinking, setUnlink]   = useState(false);

  // Notification settings — initialise from profile
  const [notifs, setNotifs] = useState({
    notifProjectTaken: profile?.notif_project_taken !== false,
    notifTeamInvite:   profile?.notif_team_invite   !== false,
    notifComment:      profile?.notif_comment        !== false,
    notifDeadline:     profile?.notif_deadline       !== false,
    notifTask:         profile?.notif_task           !== false,
    notifNewProject:   profile?.notif_new_project    !== false,
  });
  const [savingNotifs, setSavingNotifs] = useState(false);

  // Web Push (этого устройства)
  const [pushState, setPushState] = useState({ supported: false, subscribed: false, permission: "default" });
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => { getPushState().then(setPushState).catch(() => {}); }, []);
  const isIOSNonPWA = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (pushState.subscribed) { await disablePush(client); showToast("Push выключен на этом устройстве"); }
      else { await enablePush(client); showToast("✓ Push включён на этом устройстве"); }
      setPushState(await getPushState());
    } catch (e) { showToast("Ошибка push: " + (e.message || ""), "error"); }
    finally { setPushBusy(false); }
  };

  const isLinked = !!profile?.telegram_chat_id;

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await client
        .from("profiles")
        .update({ name: name.trim() || null })
        .eq("id", profile.id)
        .select()
        .single();
      if (error) throw error;
      onProfileUpdated(data);
      showToast("✓ Профиль обновлён");
      onClose();
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    } finally {
      setSaving(false);
    }
  };

  const generateCode = async () => {
    setGenLoad(true);
    try {
      const code = await generateTelegramLinkCode(client);
      setLinkCode(code);
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    } finally {
      setGenLoad(false);
    }
  };

  const doUnlink = async () => {
    setUnlink(true);
    try {
      await unlinkTelegram(client);
      onProfileUpdated({ ...profile, telegram_chat_id: null });
      showToast("Telegram отвязан");
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    } finally {
      setUnlink(false);
    }
  };

  const saveNotifs = async (updated) => {
    setSavingNotifs(true);
    try {
      await updateNotificationSettings(client, updated);
      // notif_new_project нет в RPC — пишем прямым update под RLS
      await client.from("profiles").update({ notif_new_project: updated.notifNewProject }).eq("id", profile.id);
      onProfileUpdated({ ...profile,
        notif_project_taken: updated.notifProjectTaken,
        notif_team_invite:   updated.notifTeamInvite,
        notif_comment:       updated.notifComment,
        notif_deadline:      updated.notifDeadline,
        notif_task:          updated.notifTask,
        notif_new_project:   updated.notifNewProject,
      });
    } catch (e) {
      showToast("Ошибка сохранения настроек: " + (e.message || ""), "error");
    } finally {
      setSavingNotifs(false);
    }
  };

  const toggleNotif = (key) => {
    const updated = { ...notifs, [key]: !notifs[key] };
    setNotifs(updated);
    saveNotifs(updated);
  };

  // UI-компонент переключателя уведомления
  const NotifToggle = ({ label, notifKey }) => (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
    }}>
      <span style={{ fontSize: 12, color: "#a8a8a3" }}>{label}</span>
      <button
        onClick={() => toggleNotif(notifKey)}
        disabled={savingNotifs}
        style={{
          width: 36, height: 20, borderRadius: 10, border: "none",
          cursor: "pointer", transition: "all 0.2s", padding: 0,
          background: notifs[notifKey] ? "#d4af37" : "rgba(255,255,255,0.10)",
          position: "relative",
        }}
      >
        <span style={{
          position: "absolute", top: 2,
          left: notifs[notifKey] ? 18 : 2,
          width: 16, height: 16, borderRadius: "50%",
          background: "#fafaf7", transition: "left 0.2s",
        }} />
      </button>
    </div>
  );

  return (
    <Modal
      title="Мой профиль"
      onClose={() => !saving && onClose()}
      icon={<User size={16} />}
      maxWidth={460}
    >
      {/* Шапка профиля */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14, marginBottom: 18,
        padding: "12px 14px", borderRadius: 12,
        background: "rgba(212,175,55,0.04)",
        border: "1px solid rgba(212,175,55,0.12)",
      }}>
        <UserAvatar name={name || profile?.email} size={46} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#fafaf7", letterSpacing: "-0.01em" }}>
            {name || profile?.email?.split("@")[0]}
          </div>
          <div style={{ fontSize: 11, color: "#a8a8a3", marginTop: 2 }}>{profile?.email}</div>
        </div>
        {profile?.role === "admin" && (
          <span style={{
            fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 600,
            background: "rgba(212,175,55,0.12)", color: "#d4af37",
            border: "1px solid rgba(212,175,55,0.25)",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <Sparkles size={10} strokeWidth={2.4} /> ADMIN
          </span>
        )}
      </div>

      {/* Отображаемое имя */}
      <Field label="Отображаемое имя">
        <StyledInput
          value={name}
          onChange={e => setSaveName(e.target.value)}
          placeholder="Например: Иван Иванов"
          onKeyDown={e => { if (e.key === "Enter") save(); }}
        />
      </Field>
      <div style={{ fontSize: 11, color: "#6b6b67", marginBottom: 16, lineHeight: 1.5 }}>
        Это имя видят другие участники команды. Email и роль изменить нельзя.
      </div>

      {/* ── Telegram-привязка ─────────────────────────────────────────────── */}
      <div style={{
        marginBottom: 16, padding: "12px 14px", borderRadius: 10,
        background: isLinked ? "rgba(110,231,168,0.04)" : "rgba(147,197,253,0.04)",
        border: `1px solid ${isLinked ? "rgba(110,231,168,0.15)" : "rgba(147,197,253,0.15)"}`,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.10em",
          textTransform: "uppercase", marginBottom: 10,
          color: isLinked ? "#6ee7a8" : "#93c5fd",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <Send size={11} strokeWidth={2.4} />
          Telegram
          {isLinked && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— привязан ✓</span>}
        </div>

        {isLinked ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#a8a8a3" }}>
              Уведомления настроены ниже
            </span>
            <button
              onClick={doUnlink}
              disabled={unlinking}
              style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 6,
                background: "rgba(248,163,163,0.08)", border: "1px solid rgba(248,163,163,0.25)",
                color: "#f8a3a3", cursor: "pointer",
              }}
            >
              {unlinking ? "…" : "Отвязать"}
            </button>
          </div>
        ) : (
          <>
            {!linkCode ? (
              <>
                <p style={{ fontSize: 12, color: "#a8a8a3", margin: "0 0 10px", lineHeight: 1.5 }}>
                  Привяжи Telegram чтобы получать уведомления о событиях в проектах.
                </p>
                <button
                  onClick={generateCode}
                  disabled={genLoading}
                  className={BTN.primary}
                  style={{ width: "100%", opacity: genLoading ? 0.6 : 1 }}
                >
                  {genLoading ? "Генерируем…" : "Привязать Telegram"}
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 12, color: "#a8a8a3", margin: "0 0 8px", lineHeight: 1.5 }}>
                  Открой Telegram, найди бота <b>@daniilcoop_bot</b> и отправь ему:
                </p>
                <div style={{
                  background: "#0a0a0a", borderRadius: 8, padding: "8px 12px",
                  fontFamily: "ui-monospace, monospace", fontSize: 15,
                  color: "#d4af37", letterSpacing: "0.15em", textAlign: "center",
                  border: "1px solid rgba(212,175,55,0.25)",
                  marginBottom: 8,
                }}>
                  /start {linkCode}
                </div>
                <p style={{ fontSize: 10, color: "#6b6b67", margin: 0 }}>
                  Код действует 10 минут. После отправки страница обновится автоматически.
                </p>
                <button
                  onClick={generateCode}
                  style={{
                    marginTop: 8, fontSize: 11, color: "#6b6b67",
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  Обновить код
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Push-уведомления (Web Push, этого устройства) ────────────────── */}
      <div style={{
        marginBottom: 16, padding: "12px 14px", borderRadius: 10,
        background: "rgba(147,197,253,0.04)", border: "1px solid rgba(147,197,253,0.15)",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.10em",
          textTransform: "uppercase", marginBottom: 10, color: "#93c5fd",
        }}>
          Push-уведомления
        </div>
        {!pushState.supported ? (
          <p style={{ fontSize: 12, color: "#a8a8a3", margin: 0, lineHeight: 1.5 }}>
            {isIOSNonPWA
              ? "На iPhone push работает только из приложения, установленного через Safari (Opera, Chrome и др. не подойдут — ограничение Apple). Откройте этот сайт в Safari → нажмите «Поделиться» (квадрат со стрелкой ↑ внизу экрана) → пролистайте меню вниз до пункта «На экран Домой» → «Добавить». Затем откройте КЛИМАТ-ПРО с домашнего экрана (как отдельное приложение) и включите push здесь."
              : "Этот браузер не поддерживает push-уведомления."}
          </p>
        ) : pushState.permission === "denied" ? (
          <p style={{ fontSize: 12, color: "#f8a3a3", margin: 0, lineHeight: 1.5 }}>
            Уведомления заблокированы в настройках браузера для этого сайта — разрешите их, чтобы включить push.
          </p>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#a8a8a3" }}>
              {pushState.subscribed ? "Включены на этом устройстве" : "Получать уведомления на этом устройстве"}
            </span>
            <button onClick={togglePush} disabled={pushBusy} style={{
              width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
              transition: "all 0.2s", padding: 0,
              background: pushState.subscribed ? "#d4af37" : "rgba(255,255,255,0.10)", position: "relative",
            }}>
              <span style={{
                position: "absolute", top: 2, left: pushState.subscribed ? 18 : 2,
                width: 16, height: 16, borderRadius: "50%", background: "#fafaf7", transition: "left 0.2s",
              }} />
            </button>
          </div>
        )}
      </div>

      {/* ── Типы уведомлений ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, letterSpacing: "0.10em",
          textTransform: "uppercase", marginBottom: 8, color: "#6b6b67",
        }}>
          Какие уведомления получать
        </div>
        <NotifToggle label="Новый проект в поиске исполнителя"           notifKey="notifNewProject" />
        <NotifToggle label="Кто-то взял мой проект из маркетплейса"      notifKey="notifProjectTaken" />
        <NotifToggle label="Меня пригласили в команду проекта"          notifKey="notifTeamInvite" />
        <NotifToggle label="Комментарий / вопрос по задаче"             notifKey="notifComment" />
        <NotifToggle label="Приближается дедлайн"                       notifKey="notifDeadline" />
        <NotifToggle label="Уведомления о задачах"                      notifKey="notifTask" />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onClose} className={BTN.ghost} style={{ flex: 1 }} disabled={saving}>Закрыть</button>
        <button onClick={save} className={BTN.primary} style={{ flex: 2, opacity: saving ? 0.6 : 1 }} disabled={saving}>
          {saving ? "Сохраняем..." : "Сохранить"}
        </button>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN PAGE — административная панель (v1.5, видна только role=admin)
// ════════════════════════════════════════════════════════════════════════════
function AdminPage({ profile, client, showToast }) {
  const [section, setSection] = useState("users");
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [resetUser, setResetUser] = useState(null);   // пользователь для сброса пароля
  const [resetPwd, setResetPwd] = useState("");
  const [resetPwd2, setResetPwd2] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      if (section === "users") {
        setUsers(await adminListUsers(client));
      } else if (section === "stats") {
        setStats(await adminSystemStats(client));
      } else if (section === "activity") {
        setActivity(await adminFetchActivityLog(client, 100));
      }
    } catch (e) {
      showToast("Ошибка загрузки: " + (e.message || ""), "error");
    }
    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [section]);

  const toggleApproval = async (u) => {
    try {
      await adminUpdateUser(client, u.id, { approved: !u.approved });
      showToast(u.approved ? "Доступ отозван" : "Пользователь одобрен");
      reload();
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    }
  };

  const toggleAdmin = async (u) => {
    try {
      await adminUpdateUser(client, u.id, { role: u.role === "admin" ? "user" : "admin" });
      showToast(u.role === "admin" ? "Права admin сняты" : "Назначен admin");
      reload();
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    }
  };

  const doDelete = async (u) => {
    if (confirmText.toLowerCase() !== u.email.toLowerCase()) {
      showToast("Введи email пользователя точно для подтверждения", "error");
      return;
    }
    try {
      await adminDeleteUser(client, u.id);
      showToast(`Пользователь ${u.email} удалён со всеми данными`);
      setConfirmDel(null);
      setConfirmText("");
      reload();
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    }
  };

  const doResetPassword = async () => {
    if (!resetUser) return;
    if (resetPwd.length < 8) { showToast("Пароль минимум 8 символов", "error"); return; }
    if (resetPwd !== resetPwd2) { showToast("Пароли не совпадают", "error"); return; }
    try {
      await adminResetPassword(client, resetUser.id, resetPwd);
      showToast(`Пароль для ${resetUser.email} сброшен`);
      setResetUser(null); setResetPwd(""); setResetPwd2("");
    } catch (e) {
      showToast("Ошибка: " + (e.message || ""), "error");
    }
  };

  const filteredUsers = users.filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {/* Подвкладки админки */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {[
          { id: "users",    label: "Пользователи", Icon: Users },
          { id: "stats",    label: "Статистика",   Icon: Activity },
          { id: "activity", label: "Журнал",       Icon: ScrollText },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 500,
              background: section === s.id ? "rgba(212,175,55,0.15)" : "rgba(255,255,255,0.04)",
              color: section === s.id ? "#d4af37" : "#a8a8a3",
              border: `1px solid ${section === s.id ? "rgba(212,175,55,0.30)" : "rgba(255,255,255,0.06)"}`,
              display: "inline-flex", alignItems: "center", gap: 6,
              fontFamily: "inherit",
            }}
          >
            <s.Icon size={13} strokeWidth={2.2} /> {s.label}
          </button>
        ))}
      </div>

      {/* Раздел "Пользователи" */}
      {section === "users" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 360 }}>
              <Search size={14} strokeWidth={2.2} style={{
                position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                color: "#6b6b67", pointerEvents: "none",
              }} />
              <StyledInput
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по email или имени..."
                style={{ paddingLeft: 36 }}
              />
            </div>
            {!loading && (
              <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#a8a8a3" }}>
                <span>Всего: <span style={{ color: "#fafaf7", fontWeight: 600 }}>{users.length}</span></span>
                <span>Одобрено: <span style={{ color: "#6ee7a8", fontWeight: 600 }}>{users.filter(u => u.approved).length}</span></span>
                <span>Ждут: <span style={{ color: "#f3d77b", fontWeight: 600 }}>{users.filter(u => !u.approved).length}</span></span>
              </div>
            )}
          </div>

          {loading ? (
            <Empty text="Загружаем..." />
          ) : filteredUsers.length === 0 ? (
            <Empty text="Никто не подходит под фильтр" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredUsers.map(u => (
                <div key={u.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", borderRadius: 10,
                  background: "#141414",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <UserAvatar name={u.name} email={u.email} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: "#fafaf7", fontWeight: 500 }}>
                        {u.name || u.email.split("@")[0]}
                      </span>
                      {u.role === "admin" && (
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 4, fontWeight: 600, letterSpacing: "0.06em",
                          background: "rgba(212,175,55,0.12)", color: "#d4af37",
                          border: "1px solid rgba(212,175,55,0.25)",
                        }}>ADMIN</span>
                      )}
                      {!u.approved && (
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 4, fontWeight: 600, letterSpacing: "0.06em",
                          background: "rgba(243,215,123,0.10)", color: "#f3d77b",
                          border: "1px solid rgba(243,215,123,0.25)",
                        }}>ЖДЁТ</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#6b6b67", marginTop: 1 }}>{u.email}</div>
                    <div style={{ fontSize: 10, color: "#6b6b67", marginTop: 2 }}>
                      {u.projects_count} проектов · {u.transactions_count} транзакций
                      {u.created_at && <> · с {new Date(u.created_at).toLocaleDateString("ru-RU")}</>}
                    </div>
                  </div>
                  {u.id !== profile.id && (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => toggleApproval(u)}
                        title={u.approved ? "Отозвать доступ" : "Одобрить"}
                        style={{
                          padding: 6, borderRadius: 6, cursor: "pointer", border: "1px solid",
                          background: u.approved ? "rgba(255,255,255,0.04)" : "rgba(110,231,168,0.10)",
                          borderColor: u.approved ? "rgba(255,255,255,0.10)" : "rgba(110,231,168,0.30)",
                          color: u.approved ? "#a8a8a3" : "#6ee7a8",
                          display: "flex",
                        }}
                      >
                        {u.approved ? <UserMinus size={13} strokeWidth={2.2} /> : <UserCheck size={13} strokeWidth={2.2} />}
                      </button>
                      <button
                        onClick={() => toggleAdmin(u)}
                        title={u.role === "admin" ? "Снять admin" : "Сделать admin"}
                        style={{
                          padding: 6, borderRadius: 6, cursor: "pointer", border: "1px solid",
                          background: u.role === "admin" ? "rgba(212,175,55,0.10)" : "rgba(255,255,255,0.04)",
                          borderColor: u.role === "admin" ? "rgba(212,175,55,0.30)" : "rgba(255,255,255,0.10)",
                          color: u.role === "admin" ? "#d4af37" : "#a8a8a3",
                          display: "flex",
                        }}
                      >
                        <ShieldCheck size={13} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() => { setResetUser(u); setResetPwd(""); setResetPwd2(""); }}
                        title="Сбросить пароль"
                        style={{
                          padding: 6, borderRadius: 6, cursor: "pointer", border: "1px solid",
                          background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)",
                          color: "#a8a8a3", display: "flex",
                        }}
                        onMouseOver={e => { e.currentTarget.style.color = "#e8c860"; e.currentTarget.style.borderColor = "rgba(212,175,55,0.30)"; }}
                        onMouseOut={e => { e.currentTarget.style.color = "#a8a8a3"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
                      >
                        <KeyRound size={13} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() => { setConfirmDel(u.id); setConfirmText(""); }}
                        title="Удалить пользователя"
                        style={{
                          padding: 6, borderRadius: 6, cursor: "pointer", border: "1px solid",
                          background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)",
                          color: "#a8a8a3", display: "flex",
                        }}
                        onMouseOver={e => { e.currentTarget.style.color = "#f8a3a3"; e.currentTarget.style.borderColor = "rgba(248,163,163,0.30)"; }}
                        onMouseOut={e => { e.currentTarget.style.color = "#a8a8a3"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
                      >
                        <Trash2 size={13} strokeWidth={2.2} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Раздел "Статистика" */}
      {section === "stats" && (
        <div>
          {loading || !stats ? (
            <Empty text="Загружаем..." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { label: "Пользователей всего",  value: stats.users_total,        Icon: Users,        color: "#d4af37" },
                { label: "Одобрено",             value: stats.users_approved,     Icon: UserCheck,    color: "#6ee7a8" },
                { label: "Ожидают одобрения",    value: stats.users_pending,      Icon: Hourglass,    color: "#f3d77b" },
                { label: "Проектов всего",       value: stats.projects_total,     Icon: FolderKanban, color: "#d4af37" },
                { label: "Активных проектов",    value: stats.projects_active,    Icon: Activity,     color: "#93c5fd" },
                { label: "В архиве",             value: stats.projects_archived,  Icon: Package,      color: "#6b6b67" },
                { label: "Сумма портфеля",       value: stats.portfolio_total,    Icon: Briefcase,    color: "#d4af37", format: fmt },
                { label: "Получено по портфелю", value: stats.portfolio_paid,     Icon: BadgeCheck,   color: "#6ee7a8", format: fmt },
                { label: "Транзакций всего",     value: stats.transactions_total, Icon: Receipt,      color: "#a8a8a3" },
                { label: "Доходов суммарно",     value: stats.income_total,       Icon: TrendingUp,   color: "#6ee7a8", format: fmt },
                { label: "Расходов суммарно",    value: stats.expense_total,      Icon: TrendingDown, color: "#f8a3a3", format: fmt },
              ].map((it, i) => (
                <KpiCard key={i} label={it.label} value={Number(it.value || 0)} Icon={it.Icon} color={it.color} format={it.format} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Раздел "Журнал событий" */}
      {section === "activity" && (
        <div>
          {loading ? (
            <Empty text="Загружаем..." />
          ) : activity.length === 0 ? (
            <Empty text="Журнал пуст" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {activity.map(a => {
                const labels = {
                  user_approved: { label: "Пользователь одобрен", color: "#6ee7a8", Icon: UserCheck },
                  user_revoked:  { label: "Доступ отозван",       color: "#f3d77b", Icon: UserMinus },
                  user_deleted:  { label: "Пользователь удалён",  color: "#f8a3a3", Icon: Trash2 },
                  role_changed:  { label: "Изменена роль",        color: "#d4af37", Icon: ShieldCheck },
                };
                const cfg = labels[a.action] || { label: a.action, color: "#a8a8a3", Icon: Activity };
                return (
                  <div key={a.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "8px 14px", borderRadius: 10,
                    background: "#141414",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 6,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: `${cfg.color}1a`, color: cfg.color, flexShrink: 0,
                    }}>
                      <cfg.Icon size={13} strokeWidth={2.2} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#fafaf7" }}>
                        <span style={{ fontWeight: 500 }}>{cfg.label}:</span>{" "}
                        <span style={{ color: "#a8a8a3" }}>{a.target_email || "—"}</span>
                        {a.details?.from && a.details?.to && (
                          <span style={{ color: "#6b6b67" }}> ({a.details.from} → {a.details.to})</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "#6b6b67", marginTop: 2 }}>
                        {a.actor_email} · {new Date(a.created_at).toLocaleString("ru-RU")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Модалка подтверждения удаления пользователя */}
      {confirmDel && users.find(u => u.id === confirmDel) && (() => {
        const u = users.find(x => x.id === confirmDel);
        return (
          <Modal
            title="Удалить пользователя?"
            onClose={() => { setConfirmDel(null); setConfirmText(""); }}
            icon={<AlertTriangle size={16} />}
            maxWidth={460}
          >
            <p style={{ fontSize: 13, color: "#a8a8a3", lineHeight: 1.55, marginTop: 0 }}>
              Будут безвозвратно удалены: профиль <b style={{ color: "#fafaf7" }}>{u.email}</b>,
              все его проекты ({u.projects_count}), все транзакции ({u.transactions_count}),
              записи об участии в чужих командах. Восстановить будет невозможно.
            </p>
            <Field label={`Для подтверждения введи email пользователя`}>
              <StyledInput
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={u.email}
                autoFocus
              />
            </Field>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button onClick={() => { setConfirmDel(null); setConfirmText(""); }} className={BTN.ghost} style={{ flex: 1 }}>Отмена</button>
              <button
                onClick={() => doDelete(u)}
                disabled={confirmText.toLowerCase() !== u.email.toLowerCase()}
                style={{
                  flex: 2, padding: "10px 16px", borderRadius: 8,
                  background: confirmText.toLowerCase() === u.email.toLowerCase() ? "#f8a3a3" : "rgba(248,163,163,0.20)",
                  border: "none", color: "#0a0a0a", cursor: "pointer",
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  opacity: confirmText.toLowerCase() === u.email.toLowerCase() ? 1 : 0.5,
                }}
              >
                Удалить навсегда
              </button>
            </div>
          </Modal>
        );
      })()}

      {resetUser && (
        <Modal
          title="Сбросить пароль"
          onClose={() => { setResetUser(null); setResetPwd(""); setResetPwd2(""); }}
          icon={<KeyRound size={16} />}
          maxWidth={420}
        >
          <p style={{ fontSize: 13, color: "#a8a8a3", lineHeight: 1.55, marginTop: 0 }}>
            Новый пароль для <b style={{ color: "#fafaf7" }}>{resetUser.email}</b>.
            Передайте его пользователю — войдя, он сможет сменить пароль сам.
          </p>
          <Field label="Новый пароль (минимум 8 символов)">
            <StyledInput
              type="password"
              value={resetPwd}
              onChange={e => setResetPwd(e.target.value)}
              placeholder="Новый пароль"
              autoFocus
            />
          </Field>
          <Field label="Повторите пароль">
            <StyledInput
              type="password"
              value={resetPwd2}
              onChange={e => setResetPwd2(e.target.value)}
              placeholder="Ещё раз"
              onKeyDown={e => { if (e.key === "Enter") doResetPassword(); }}
            />
          </Field>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button onClick={() => { setResetUser(null); setResetPwd(""); setResetPwd2(""); }} className={BTN.ghost} style={{ flex: 1 }}>Отмена</button>
            <button
              onClick={doResetPassword}
              disabled={resetPwd.length < 8 || resetPwd !== resetPwd2}
              className={BTN.primary}
              style={{ flex: 2, opacity: (resetPwd.length >= 8 && resetPwd === resetPwd2) ? 1 : 0.5 }}
            >
              Сбросить пароль
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// BACKUP / MIGRATION PANEL
// ════════════════════════════════════════════════════════════════════════════
// Модальное окно с тремя инструментами:
//   1. Экспорт текущих данных в JSON (надёжный — через textarea, не window.open)
//   2. Импорт из JSON-бэкапа (вставка в textarea)
//   3. Автоматический импорт из window.storage предыдущей версии артефакта
function BackupPanel({ projects, txs, client, ownerId, onImported, onClose, showToast }) {
  const [tab, setTab] = useState("export");        // export | import | legacy
  const [importJson, setImportJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [legacyData, setLegacyData] = useState(null);
  const [legacyChecked, setLegacyChecked] = useState(false);

  // При открытии вкладки legacy — сразу пробуем прочитать window.storage
  useEffect(() => {
    if (tab === "legacy" && !legacyChecked) {
      (async () => {
        try {
          const [pRes, tRes] = await Promise.all([
            window.storage?.get?.(LEGACY_KEY_PROJECTS),
            window.storage?.get?.(LEGACY_KEY_TXS),
          ]);
          const p = pRes ? JSON.parse(pRes.value) : [];
          const t = tRes ? JSON.parse(tRes.value) : [];
          setLegacyData({ projects: p || [], txs: t || [] });
        } catch (e) {
          setLegacyData({ projects: [], txs: [] });
        }
        setLegacyChecked(true);
      })();
    }
  }, [tab, legacyChecked]);

  const exportJson = JSON.stringify({
    version: 2,
    exportedAt: new Date().toISOString(),
    projects,
    txs,
  }, null, 2);

  const doImport = async (data) => {
    setBusy(true);
    try {
      // Валидация: data должна содержать массивы projects и txs
      if (!data || !Array.isArray(data.projects) || !Array.isArray(data.txs)) {
        throw new Error("Неверный формат бэкапа: ожидаются поля projects и txs");
      }
      const insertedP = await insertProjectsBulk(client, data.projects, ownerId);
      const insertedT = await insertTransactionsBulk(client, data.txs, ownerId);
      onImported(insertedP, insertedT);
      showToast(`✓ Импортировано: проектов ${insertedP.length}, транзакций ${insertedT.length}`);
      onClose();
    } catch (e) {
      showToast("Ошибка импорта: " + (e.message || ""), "error");
    } finally {
      setBusy(false);
    }
  };

  const importFromJsonText = async () => {
    try {
      const data = JSON.parse(importJson);
      await doImport(data);
    } catch (e) {
      if (e instanceof SyntaxError) {
        showToast("Не удалось разобрать JSON — проверь что вставлен весь текст", "error");
      } else {
        showToast("Ошибка: " + (e.message || ""), "error");
      }
    }
  };

  return (
    <Modal title="📦 Резервная копия и миграция" onClose={onClose} maxWidth={580}>
      {/* Табы */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {[
          {id:"export", label:"Экспорт"},
          {id:"import", label:"Импорт из JSON"},
          {id:"legacy", label:"Перенос из v1"},
        ].map(t => (
          <Chip key={t.id} label={t.label} active={tab===t.id} onClick={()=>setTab(t.id)}/>
        ))}
      </div>

      {tab === "export" && (
        <div>
          <p style={{fontSize:13,color:"#a8a8a3",marginBottom:12,lineHeight:1.5}}>
            Все твои проекты ({projects.length}) и транзакции ({txs.length}) в формате JSON.
            Скопируй текст ниже и сохрани в файл — это твоя страховка.
            Длинный тап по полю → «Выделить всё» → «Копировать».
          </p>
          <StyledTextarea
            readOnly
            value={exportJson}
            rows={10}
            style={{fontFamily:"ui-monospace,monospace",fontSize:11}}
            onClick={e => e.target.select()}
          />
          <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(exportJson);
                  showToast("✓ JSON скопирован в буфер обмена");
                } catch {
                  showToast("Не удалось скопировать автоматически — выдели вручную", "error");
                }
              }}
              className={BTN.primary}
              style={{flex:1}}
            >
              📋 Скопировать в буфер
            </button>
          </div>
        </div>
      )}

      {tab === "import" && (
        <div>
          <p style={{fontSize:13,color:"#a8a8a3",marginBottom:12,lineHeight:1.5}}>
            Вставь JSON-бэкап (полученный из вкладки «Экспорт» или из старой версии артефакта).
            Все записи будут добавлены к существующим — НЕ удалят их.
          </p>
          <StyledTextarea
            value={importJson}
            onChange={e=>setImportJson(e.target.value)}
            rows={8}
            placeholder='{"projects":[...],"txs":[...]}'
            style={{fontFamily:"ui-monospace,monospace",fontSize:11}}
          />
          <button
            onClick={importFromJsonText}
            disabled={busy || !importJson.trim()}
            className={BTN.primary}
            style={{width:"100%",marginTop:12,opacity:busy||!importJson.trim()?0.5:1}}
          >
            {busy ? "Импортируем..." : "📥 Импортировать в Supabase"}
          </button>
        </div>
      )}

      {tab === "legacy" && (
        <div>
          <p style={{fontSize:13,color:"#a8a8a3",marginBottom:12,lineHeight:1.5}}>
            Попытка прочитать данные из локального хранилища предыдущей версии
            (window.storage). Сработает только если этот артефакт открыт в той же
            среде Claude, что и старый. Если нет — используй вкладку «Импорт из JSON».
          </p>
          {!legacyChecked ? (
            <p style={{color:"#6b6b67",fontSize:13}}>Проверяю...</p>
          ) : !legacyData || (legacyData.projects.length === 0 && legacyData.txs.length === 0) ? (
            <div style={{
              background:"#141414",border:"1px solid #1c1c1a",borderRadius:12,
              padding:16,textAlign:"center",color:"#a8a8a3",fontSize:13,
            }}>
              В локальном хранилище нет данных предыдущей версии.
              Воспользуйся вкладкой «Импорт из JSON».
            </div>
          ) : (
            <>
              <div style={{
                background:"#141414",borderRadius:12,padding:14,marginBottom:12,
                display:"flex",justifyContent:"space-around",
              }}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:10,color:"#6b6b67",fontWeight:700,textTransform:"uppercase"}}>Проектов</div>
                  <div style={{fontSize:22,fontWeight:900,color:"#e8c860",marginTop:2}}>{legacyData.projects.length}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:10,color:"#6b6b67",fontWeight:700,textTransform:"uppercase"}}>Транзакций</div>
                  <div style={{fontSize:22,fontWeight:900,color:"#d4af37",marginTop:2}}>{legacyData.txs.length}</div>
                </div>
              </div>
              <button
                onClick={()=>doImport(legacyData)}
                disabled={busy}
                className={BTN.primary}
                style={{width:"100%",opacity:busy?0.5:1}}
              >
                {busy ? "Импортируем..." : "📥 Перенести в Supabase"}
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT VIEWER (тот же что в v1, без существенных изменений)
// ════════════════════════════════════════════════════════════════════════════
function ReportViewer({ projects, onClose }) {
  const [stage, setStage] = useState("all");
  const [showPreview, setShowPreview] = useState(false);

  const stages = ["all", ...PROJECT_STAGES.filter(s => s !== "Архив")];
  const labels  = {"all":"Все активные",...Object.fromEntries(PROJECT_STAGES.map(s=>[s,s]))};

  const visible = stage === "all"
    ? projects.filter(p => p.stage !== "Архив")
    : projects.filter(p => p.stage === stage);

  const totalContract = visible.reduce((s,p)=>s+(+p.contractSum||0),0);
  const totalPaid     = visible.reduce((s,p)=>s+(+p.paidAmount||0),0);
  const totalDebt     = totalContract - totalPaid;
  const now           = new Date();
  const dateStr       = now.toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"});

  const stageColor = {
    "Переговоры":"#a8a8a3","КП выслано":"#93c5fd","Договор подписан":"#d4af37",
    "В работе":"#d4af37","Сдан заказчику":"#6ee7a8","Оплачен":"#6ee7a8","Архив":"#404040"
  };

  useEffect(() => {
    const id = "report-print-style";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      @media print {
        body > * { display: none !important; }
        #report-print-root { display: block !important; }
        #report-print-root .no-print { display: none !important; }
      }
      @media screen {
        #report-print-root { display: none; }
      }
    `;
    document.head.appendChild(s);
    return () => { const el=document.getElementById(id); if(el) el.remove(); };
  }, []);

  useEffect(() => {
    if (!showPreview) return;
    let el = document.getElementById("report-print-root");
    if (!el) { el = document.createElement("div"); el.id = "report-print-root"; document.body.appendChild(el); }
    const sc = stageColor;
    const rows = visible.map((p,i) => {
      const contract=+p.contractSum||0, paid=+p.paidAmount||0, debt=contract-paid;
      const c=sc[p.stage]||"#d4af37";
      return `<tr style="background:${i%2===0?"white":"#fafafa"}">
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;">
          <div style="font-weight:700;color:#0a0a0a;font-size:13px;">${p.name}</div>
          ${p.client?`<div style="color:#6b6b67;font-size:11px;margin-top:1px;">${p.client}</div>`:""}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#404040;">${p.type||"—"}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#404040;">${p.executor||"—"}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;">
          <span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;background:${c}22;color:${c};">${p.stage}</span>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;color:#0a0a0a;font-size:13px;">${contract>0?fmt(contract):"—"}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:#6ee7a8;font-size:13px;">${paid>0?fmt(paid):"—"}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-size:13px;color:${debt>0?"#f8a3a3":"#6ee7a8"};">${contract>0?(debt>0?fmt(debt):"✓"):"—"}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:12px;color:#6b6b67;">${p.deadline?new Date(p.deadline+"T00:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"short"}):"—"}</td>
      </tr>`;
    }).join("");
    el.innerHTML = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;min-height:100vh;padding:32px 24px;">
        <div style="max-width:1050px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#0a0a0a,#1c1c1a);border-radius:16px;padding:28px 36px;color:white;margin-bottom:20px;">
            <div style="font-size:21px;font-weight:900;letter-spacing:-.02em;margin-bottom:4px;"><span style="color:#a5b4fc;">Д</span>АНИИЛ — Отчёт по проектам</div>
            <div style="font-size:13px;opacity:.7;">Сформирован ${dateStr} · ${labels[stage]} · ${visible.length} проектов</div>
            <div style="display:flex;gap:14px;margin-top:18px;flex-wrap:wrap;">
              ${[
                {l:"Сумма договоров",v:fmt(totalContract),c:"#93c5fd"},
                {l:"Получено",v:fmt(totalPaid),c:"#6ee7b7"},
                {l:"К получению",v:fmt(totalDebt),c:totalDebt>0?"#f8a3a3":"#6ee7b7"},
                {l:"% оплаты",v:`${totalContract>0?Math.round(totalPaid/totalContract*100):0}%`,c:"white"},
              ].map(k=>`<div style="background:rgba(255,255,255,.12);border-radius:12px;padding:12px 18px;min-width:130px;">
                <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.1em;font-weight:700;">${k.l}</div>
                <div style="font-size:19px;font-weight:900;color:${k.c};margin-top:4px;">${k.v}</div>
              </div>`).join("")}
            </div>
          </div>
          ${visible.length===0
            ? `<div style="text-align:center;padding:48px;color:#a8a8a3;">Нет проектов</div>`
            : `<div style="background:white;border-radius:14px;border:1px solid #fafaf7;overflow:hidden;margin-bottom:20px;">
                <table style="width:100%;border-collapse:collapse;">
                  <thead><tr style="background:#f8fafc;">
                    ${["Проект / Клиент","Тип работ","Исполнитель","Стадия","По договору","Оплачено","Остаток","Дедлайн"].map((h,i)=>`<th style="padding:10px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#a8a8a3;border-bottom:2px solid #fafaf7;text-align:${i>=4?"right":"left"};">${h}</th>`).join("")}
                  </tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>`}
          ${visible.some(p=>p.notes)?`<div style="background:white;border-radius:12px;border:1px solid #fafaf7;padding:18px 22px;margin-bottom:16px;">
            <div style="font-size:11px;font-weight:700;color:#a8a8a3;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;">Примечания</div>
            ${visible.filter(p=>p.notes).map(p=>`<div style="margin-bottom:6px;font-size:13px;"><b>${p.name}:</b> <span style="color:#404040;">${p.notes}</span></div>`).join("")}
          </div>`:""}
          <div style="text-align:center;font-size:12px;color:#cbd5e1;padding-top:8px;">КЛИМАТ-ПРО · ${dateStr}</div>
        </div>
      </div>`;
    return () => { const e=document.getElementById("report-print-root"); if(e) e.innerHTML=""; };
  }, [showPreview, stage, visible]);

  if (showPreview) return (
    <div style={{position:"fixed",inset:0,zIndex:200,background:"white",overflowY:"auto"}}>
      <div style={{
        position:"sticky",top:0,zIndex:10,
        background:"#1c1c1a",padding:"10px 24px",
        display:"flex",justifyContent:"space-between",alignItems:"center",
        boxShadow:"0 2px 12px rgba(0,0,0,.3)"
      }}>
        <span style={{color:"white",fontWeight:700,fontSize:14}}>📄 Отчёт готов</span>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <div style={{
            background:"rgba(255,255,255,.1)",borderRadius:8,
            padding:"7px 14px",display:"flex",alignItems:"center",gap:8,
          }}>
            <span style={{fontSize:13,color:"#a5b4fc",fontWeight:600}}>🖨 Для PDF нажми</span>
            <kbd style={{
              background:"white",color:"#1c1c1a",borderRadius:5,
              padding:"2px 8px",fontFamily:"monospace",fontSize:13,fontWeight:800,
            }}>Ctrl+P</kbd>
            <span style={{fontSize:12,color:"#e8c860"}}>или</span>
            <kbd style={{
              background:"white",color:"#1c1c1a",borderRadius:5,
              padding:"2px 8px",fontFamily:"monospace",fontSize:13,fontWeight:800,
            }}>Cmd+P</kbd>
            <span style={{fontSize:12,color:"#e8c860"}}>→ «Сохранить как PDF»</span>
          </div>
          <button onClick={()=>setShowPreview(false)} style={{
            padding:"8px 14px",borderRadius:8,background:"#1c1c1a",border:"none",
            color:"white",fontWeight:600,fontSize:13,cursor:"pointer"
          }}>← Назад</button>
        </div>
      </div>
      <div id="report-inline" style={{
        fontFamily:"system-ui,sans-serif",background:"#f8fafc",minHeight:"calc(100vh - 52px)"
      }}>
        <div style={{maxWidth:1050,margin:"0 auto",padding:"28px 24px"}}>
          <div style={{background:"linear-gradient(135deg,#0a0a0a,#1c1c1a)",borderRadius:16,padding:"28px 36px",color:"white",marginBottom:20}}>
            <div style={{fontSize:21,fontWeight:900,letterSpacing:"-.02em",marginBottom:4}}>
              <span style={{color:"#a5b4fc"}}>Д</span>АНИИЛ — Отчёт по проектам
            </div>
            <div style={{fontSize:13,opacity:.7}}>Сформирован {dateStr} · {labels[stage]} · {visible.length} проектов</div>
            <div style={{display:"flex",gap:14,marginTop:18,flexWrap:"wrap"}}>
              {[
                {l:"Сумма договоров",v:fmt(totalContract),c:"#93c5fd"},
                {l:"Получено",       v:fmt(totalPaid),     c:"#6ee7b7"},
                {l:"К получению",    v:fmt(totalDebt),     c:totalDebt>0?"#f8a3a3":"#6ee7b7"},
                {l:"% оплаты",       v:`${totalContract>0?Math.round(totalPaid/totalContract*100):0}%`, c:"white"},
              ].map(k=>(
                <div key={k.l} style={{background:"rgba(255,255,255,.12)",borderRadius:12,padding:"12px 18px",minWidth:130}}>
                  <div style={{fontSize:10,opacity:.7,textTransform:"uppercase",letterSpacing:".1em",fontWeight:700}}>{k.l}</div>
                  <div style={{fontSize:19,fontWeight:900,color:k.c,marginTop:4}}>{k.v}</div>
                </div>
              ))}
            </div>
          </div>
          {visible.length===0
            ? <div style={{textAlign:"center",padding:48,color:"#a8a8a3",fontSize:14}}>Нет проектов</div>
            : <div style={{background:"white",borderRadius:14,border:"1px solid #fafaf7",overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:20}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:760}}>
                  <thead>
                    <tr style={{background:"#f8fafc"}}>
                      {["Проект / Клиент","Тип работ","Исполнитель","Стадия","По договору","Оплачено","Остаток","Дедлайн"].map((h,i)=>(
                        <th key={h} style={{padding:"10px 14px",fontSize:10,fontWeight:700,textTransform:"uppercase",
                          letterSpacing:".1em",color:"#a8a8a3",borderBottom:"2px solid #fafaf7",
                          textAlign:i>=4?"right":"left"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p,i)=>{
                      const contract=+p.contractSum||0,paid=+p.paidAmount||0,debt=contract-paid;
                      const c=stageColor[p.stage]||"#d4af37";
                      return (
                        <tr key={p.id} style={{background:i%2===0?"white":"#fafafa"}}>
                          <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9"}}>
                            <div style={{fontWeight:700,color:"#0a0a0a",fontSize:13}}>{p.name}</div>
                            {p.client&&<div style={{color:"#6b6b67",fontSize:11,marginTop:1}}>{p.client}</div>}
                          </td>
                          <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12,color:"#404040"}}>{p.type||"—"}</td>
                          <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",fontSize:12,color:"#404040"}}>{p.executor||"—"}</td>
                          <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9"}}>
                            <span style={{display:"inline-block",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:c+"22",color:c}}>{p.stage}</span>
                          </td>
                          <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",textAlign:"right",fontWeight:600,color:"#0a0a0a",fontSize:13}}>{contract>0?fmt(contract):"—"}</td>
                          <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",textAlign:"right",fontWeight:700,color:"#6ee7a8",fontSize:13}}>{paid>0?fmt(paid):"—"}</td>
                          <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",textAlign:"right",fontWeight:700,fontSize:13,color:debt>0?"#f8a3a3":"#6ee7a8"}}>{contract>0?(debt>0?fmt(debt):"✓"):"—"}</td>
                          <td style={{padding:"10px 14px",borderBottom:"1px solid #f1f5f9",textAlign:"right",fontSize:12,color:"#6b6b67"}}>{p.deadline?new Date(p.deadline+"T00:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"short"}):"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>}
          {visible.some(p=>p.notes)&&(
            <div style={{background:"white",borderRadius:12,border:"1px solid #fafaf7",padding:"18px 22px",marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:700,color:"#a8a8a3",textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>Примечания</div>
              {visible.filter(p=>p.notes).map(p=>(
                <div key={p.id} style={{marginBottom:6,fontSize:13}}>
                  <b>{p.name}:</b> <span style={{color:"#404040"}}>{p.notes}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{textAlign:"center",fontSize:12,color:"#cbd5e1",paddingBottom:32}}>
            КЛИМАТ-ПРО · {dateStr}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Modal title="📄 Экспорт отчёта" onClose={onClose} maxWidth={440}>
      <p style={{fontSize:13,color:"#a8a8a3",marginBottom:16,lineHeight:1.6}}>
        Отчёт откроется прямо здесь. Нажми «Печать / PDF» — браузер сохранит красивый PDF который можно отправить заказчику.
      </p>
      <div style={{marginBottom:16}}>
        <p style={{fontSize:10,fontWeight:700,color:"#6b6b67",textTransform:"uppercase",
          letterSpacing:"0.12em",marginBottom:8}}>Фильтр по стадии</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {stages.map(s=>(
            <button key={s} onClick={()=>setStage(s)} style={{
              padding:"5px 12px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
              background:stage===s?"#d4af37":"#141414",
              color:stage===s?"white":"#a8a8a3",
              border:"none",transition:"all .15s",
            }}>{labels[s]}</button>
          ))}
        </div>
      </div>
      <div style={{
        padding:"12px 16px",background:"#141414",borderRadius:12,marginBottom:16,
        display:"flex",justifyContent:"space-between",alignItems:"center",
      }}>
        <span style={{fontSize:13,color:"#a8a8a3"}}>Проектов в отчёте</span>
        <span style={{fontSize:18,fontWeight:900,color:"#e8c860"}}>{visible.length}</span>
      </div>
      <button onClick={()=>setShowPreview(true)} style={{
        width:"100%",padding:14,borderRadius:14,background:"#d4af37",border:"none",
        color:"white",fontSize:15,fontWeight:700,cursor:"pointer",
      }}>
        👁 Открыть отчёт
      </button>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// APP ROOT — главная точка входа
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  // Стадии загрузки приложения:
  //   loading  — инициализируем Supabase и проверяем сессию
  //   auth     — пользователь не авторизован, показываем экран входа
  //   ready    — всё подключено, показываем основной интерфейс
  //   error    — критическая ошибка подключения
  const [phase, setPhase] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const isMobile = useIsMobile();

  // Регистрация service worker (канал Web Push). vite-plugin-pwa отдаёт /sw.js.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW reg failed", e));
    }
  }, []);

  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);

  const [tab, setTab]               = useState("dashboard");
  const [projects, setProjects]     = useState([]);
  const [txs, setTxs]               = useState([]);
  const [clients, setClients]       = useState([]); // v1.5

  const [reportModal, setReportModal] = useState(false);
  const [backupModal, setBackupModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false); // v1.5

  const [toast, setToast] = useState({ visible: false, text: "", type: "success" });
  const toastTimer = useRef(null);

  const showToast = useCallback((text = "✓ Сохранено", type = "success") => {
    setToast({ visible: true, text, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(t => ({ ...t, visible: false })), 2500);
  }, []);

  // ── Инициализация: проверяем сохранённую сессию ─────────────────────────
  // В отличие от версии для артефактов Claude, здесь не нужно ждать
  // загрузки библиотеки с CDN — клиент supabase уже создан на уровне
  // модуля и готов к работе. Нам остаётся только узнать, есть ли у
  // пользователя сохранённая сессия в localStorage, и если да —
  // подгрузить его профиль и данные.
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          // Сессия есть — подгружаем профиль и данные
          try {
            const prof = await fetchProfile(supabase, session.user.id);
            if (!prof.approved) {
              await signOut(supabase);
              setErrorMsg("Аккаунт ожидает одобрения администратором");
              setPhase("auth");
              return;
            }
            setUser(session.user);
            setProfile(prof);
            const [p, t, cl] = await Promise.all([
              fetchProjects(supabase),
              fetchTransactions(supabase),
              fetchClients(supabase).catch(() => []),
            ]);
            setProjects(p);
            setTxs(t);
            setClients(cl);
            setPhase("ready");
          } catch (e) {
            console.warn("Сессия есть, но профиль не загружается:", e);
            await signOut(supabase).catch(()=>{});
            setPhase("auth");
          }
        } else {
          // Сессии нет — показываем экран входа
          setPhase("auth");
        }
      } catch (e) {
        console.error("Ошибка проверки сессии:", e);
        setErrorMsg(e.message || "Не удалось подключиться к серверу");
        setPhase("error");
      }
    })();
  }, []);

  // ── Подписка на изменения сессии ────────────────────────────────────────
  // Supabase сам отслеживает события: SIGNED_IN при входе, SIGNED_OUT при
  // выходе, TOKEN_REFRESHED когда продлил токен в фоне. Нам интересен
  // только SIGNED_OUT — нужно сбросить состояние и вернуть на экран входа.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setProfile(null);
        setProjects([]);
        setTxs([]);
        setClients([]);
        setPhase("auth");
      }
    });
    return () => subscription?.unsubscribe?.();
  }, []);

  // ── Обработчик успешной авторизации ────────────────────────────────────
  const handleAuthenticated = async (u, prof) => {
    setUser(u);
    setProfile(prof);
    try {
      const [p, t, cl] = await Promise.all([
        fetchProjects(supabase),
        fetchTransactions(supabase),
        fetchClients(supabase).catch(() => []),
      ]);
      setProjects(p);
      setTxs(t);
      setClients(cl);
      setPhase("ready");
      showToast(`Добро пожаловать, ${prof.name || prof.email.split("@")[0]}!`);
    } catch (e) {
      showToast("Ошибка загрузки данных: " + (e.message || ""), "error");
      setPhase("ready");
    }
  };

  // ── Выход ──────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    await signOut(supabase);
    // onAuthStateChange сам сбросит состояние
  };

  // ── Импорт из бэкапа закончен — обновляем локальный state ─────────────
  const handleImported = (importedProjects, importedTxs) => {
    setProjects(prev => [...importedProjects, ...prev]);
    setTxs(prev => [...importedTxs, ...prev]);
  };

  // ───────────────────────────────────────────────────────────────────────
  // РЕНДЕРИНГ ПО ФАЗЕ
  // ───────────────────────────────────────────────────────────────────────

  if (phase === "loading") return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Geist Variable', system-ui, sans-serif",
    }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
        style={{
          width: 36, height: 36,
          border: "2px solid rgba(212,175,55,0.15)",
          borderTopColor: "#e8c860",
          borderRadius: "50%",
        }}
      />
    </div>
  );

  if (phase === "error") return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#f7f8f8",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      fontFamily: "'Geist Variable', system-ui, sans-serif",
    }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card"
        style={{ maxWidth: 400, textAlign: "center", borderRadius: 16, padding: 24 }}
      >
        <div style={{
          width: 56, height: 56,
          borderRadius: 14,
          background: "rgba(248,163,163,0.12)",
          border: "1px solid rgba(248,163,163,0.30)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 16px",
          color: "#f8a3a3",
        }}>
          <AlertTriangle size={28} strokeWidth={1.8} />
        </div>
        <div style={{
          fontSize: 17,
          fontWeight: 600,
          color: "#f7f8f8",
          marginBottom: 8,
          letterSpacing: "-0.02em",
        }}>
          Ошибка подключения
        </div>
        <p style={{ fontSize: 13, color: "#9b9ca4", marginBottom: 20, lineHeight: 1.5 }}>
          {errorMsg}
        </p>
        <button
          onClick={() => window.location.reload()}
          className={BTN.primary}
          style={{ width: "100%" }}
        >
          Попробовать снова
        </button>
      </motion.div>
    </div>
  );

  if (phase === "auth") return (
    <>
      <AuthScreen onAuthenticated={handleAuthenticated} />
      <Toast visible={toast.visible} text={toast.text} type={toast.type}/>
    </>
  );

  // phase === "ready"
  const TABS = [
    { id: "dashboard", label: "Дашборд",   Icon: LayoutDashboard },
    { id: "projects",  label: "Проекты",   Icon: FolderKanban },
    { id: "tasks",     label: "Задачи",    Icon: ListTodo },
    { id: "clients",   label: "Заказчики", Icon: BookUser },
    { id: "finance",   label: "Финансы",   Icon: Receipt },
    { id: "analytics", label: "Аналитика", Icon: BarChart3 },
    ...(profile?.role === "admin" ? [{ id: "admin", label: "Admin", Icon: ShieldCheck }] : []),
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#f7f8f8",
      fontFamily: "'Geist Variable', system-ui, -apple-system, sans-serif",
    }}>

      {/* Шапка с логотипом, действиями и информацией о пользователе */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: isMobile ? "12px 14px" : "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        background: "rgba(8,9,15,0.85)",
        backdropFilter: "blur(8px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        {/* Логотип */}
        <div>
          <h1 style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <span style={{
              background: "linear-gradient(135deg, #d4af37, #e8c860)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>КЛИМАТ-ПРО</span>
            <span style={{
              color: "#62646b",
              fontWeight: 400,
              fontSize: 13,
            }}>· Искусство климата, инженерия комфорта</span>
          </h1>
          <div style={{
            fontSize: 11,
            color: "#62646b",
            fontWeight: 500,
            opacity: 0.6,
            marginTop: 2,
          }}>Проектирование систем ОВиК<br/>Нам важно чем вы дышите.</div>
        </div>

        {/* Правая часть: кнопки действий и информация о пользователе */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: isMobile ? "flex-start" : "flex-end", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
            {/* Кнопка отчёта — акцентная, в фирменном цвете */}
            <button
              onClick={() => setReportModal(true)}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 500,
                background: "rgba(212,175,55,0.12)",
                border: "1px solid rgba(212,175,55,0.30)",
                color: "#e8c860",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.18s",
                fontFamily: "inherit",
              }}
              title="Экспорт отчёта для заказчика"
            >
              <FileText size={13} strokeWidth={2.2} />
              Отчёт
            </button>
            {/* Кнопка резерва — нейтральная */}
            <button
              onClick={() => setBackupModal(true)}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 500,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "#9b9ca4",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.18s",
                fontFamily: "inherit",
              }}
              title="Резерв и миграция данных"
            >
              <Package size={13} strokeWidth={2.2} />
              Резерв
            </button>
            {/* Кнопка выхода — в красноватом цвете опасности */}
            <button
              onClick={handleSignOut}
              style={{
                fontSize: 12,
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 500,
                background: "rgba(248,163,163,0.10)",
                border: "1px solid rgba(248,163,163,0.25)",
                color: "#f8a3a3",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.18s",
                fontFamily: "inherit",
              }}
              title="Выйти из аккаунта"
            >
              <LogOut size={13} strokeWidth={2.2} />
              Выход
            </button>
            <div style={{ fontSize: 11, color: "#62646b", marginLeft: 4 }}>
              {new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
          {/* Бейдж администратора и email */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {profile?.role === "admin" && (
              <span style={{
                fontSize: 9,
                padding: "2px 7px",
                borderRadius: 5,
                fontWeight: 600,
                background: "rgba(243,215,123,0.12)",
                color: "#f3d77b",
                border: "1px solid rgba(243,215,123,0.25)",
                letterSpacing: "0.08em",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}>
                <Sparkles size={9} strokeWidth={2.4} />
                ADMIN
              </span>
            )}
            <button
              onClick={() => setProfileModal(true)}
              title="Открыть мой профиль"
              style={{
                fontSize: 11,
                padding: "3px 9px",
                borderRadius: 6,
                fontWeight: 500,
                background: "rgba(110,231,168,0.10)",
                color: "#6ee7a8",
                border: "1px solid rgba(110,231,168,0.20)",
                display: "flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.18s",
              }}
              onMouseOver={e => { e.currentTarget.style.background = "rgba(110,231,168,0.18)"; }}
              onMouseOut={e => { e.currentTarget.style.background = "rgba(110,231,168,0.10)"; }}
            >
              <Cloud size={11} strokeWidth={2.2} />
              {profile?.name || profile?.email}
            </button>
          </div>
        </div>
      </div>

      {/* Навигация по вкладкам с активным индикатором */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "0 24px",
        display: "flex",
        overflowX: "auto",
        background: "rgba(8,9,15,0.85)",
        backdropFilter: "blur(8px)",
        position: "sticky",
        top: 64,
        zIndex: 40,
      }}>
        {TABS.map(t => {
          const isActive = tab === t.id;
          const TabIcon = t.Icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "12px 18px",
                fontSize: 13,
                fontWeight: 500,
                color: isActive ? "#e8c860" : "#9b9ca4",
                background: "none",
                border: "none",
                cursor: "pointer",
                transition: "color 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 8,
                whiteSpace: "nowrap",
                position: "relative",
                fontFamily: "inherit",
              }}
            >
              <TabIcon size={15} strokeWidth={isActive ? 2.4 : 2} />
              {t.label}
              {/* Анимированная подложка под активным табом — плавно перетекает между табами */}
              {isActive && (
                <motion.div
                  layoutId="activeTabIndicator"
                  style={{
                    position: "absolute",
                    bottom: -1,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: "linear-gradient(90deg, #d4af37, #e8c860)",
                    borderRadius: 2,
                  }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Содержимое страницы — обёрнуто в AnimatePresence для плавных переходов */}
      <div style={{ padding: 'clamp(12px, 4vw, 24px)', maxWidth: 1080, margin: "0 auto" }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === "dashboard" && <Dashboard projects={projects} txs={txs} clients={clients} profile={profile} />}
            {tab === "projects" && <Projects projects={projects} setProjects={setProjects} clients={clients} client={supabase} profile={profile} ownerId={profile.id} showToast={showToast} />}
            {tab === "tasks" && <TasksView client={supabase} profile={profile} projects={projects} showToast={showToast} />}
            {tab === "clients" && <ClientsPage clients={clients} setClients={setClients} projects={projects} client={supabase} ownerId={profile.id} showToast={showToast} />}
            {tab === "finance" && <Finance txs={txs} setTxs={setTxs} client={supabase} ownerId={profile.id} showToast={showToast} />}
            {tab === "analytics" && <Analytics projects={projects} txs={txs} />}
            {tab === "admin" && profile?.role === "admin" && <AdminPage profile={profile} client={supabase} showToast={showToast} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <Toast visible={toast.visible} text={toast.text} type={toast.type}/>

      {reportModal && <ReportViewer projects={projects} onClose={()=>setReportModal(false)}/>}
      {backupModal && <BackupPanel
        projects={projects}
        txs={txs}
        client={supabase}
        ownerId={profile.id}
        onImported={handleImported}
        onClose={()=>setBackupModal(false)}
        showToast={showToast}
      />}
      {profileModal && <ProfileModal
        profile={profile}
        client={supabase}
        onClose={() => setProfileModal(false)}
        onProfileUpdated={(p) => setProfile(p)}
        showToast={showToast}
      />}
    </div>
  );
}
