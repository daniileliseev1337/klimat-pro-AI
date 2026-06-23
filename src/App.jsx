import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./lib/supabase";
import { diffLines } from "./lib/lineDiff";
import { isPushSupported, getPushState, enablePush, disablePush } from "./lib/push";
import { periodRange, prevPeriodRange, granularityFor, periodBalance, trendDir, financeSeries, expenseByCategory, receivables, myTasks, ownerReceived, mySharesTotals, myProjectIncomeForMonth, selectionTotals, projectIncomeTxs, viewerShareOnProject, portfolioMineTotal } from "./lib/dashboardMetrics";
import { dueState, dueSuffix, DUE_COLORS, PRIORITY_ORDER, tasksAttention } from "./lib/taskUi.js";
import NotificationBell from "./components/NotificationBell";
import MagneticButton from "./components/MagneticButton";
import CommandPalette from "./components/CommandPalette";
import BackgroundCanvas from "./components/BackgroundCanvas";
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
  "Поиск исполнителя","В работе","Сдан заказчику","Оплачен","Архив"
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
  "В работе":         { color:"#d4af37", progress:65  },
  "Сдан заказчику":   { color:"#2dd4bf", progress:85  },
  "Оплачен":          { color:"#6ee7a8", progress:100 },
  "Архив":            { color:"#1c1c1a", progress:100 },
};

// Палитра сегментов пирогов (Финансы). Первые два РАЗНЫЕ — иначе 2-сегментные пироги
// «Источники доходов»/«Структура расходов» сливались в один цвет (были два #d4af37 подряд).
const PALETTE = ["#d4af37","#6ee7a8","#93c5fd","#f8a3a3","#8b5cf6","#ec4899","#f59e0b","#f97316"];

// Старые ключи window.storage — для попытки автоматического переноса данных
// из предыдущей версии артефакта на этапе миграции

// ════════════════════════════════════════════════════════════════════════════
// UTILS — мелкие хелперы
// ════════════════════════════════════════════════════════════════════════════
const fmt      = n  => new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",maximumFractionDigits:0}).format(+n||0);
const fmtD     = d  => d ? new Date(d+"T00:00:00").toLocaleDateString("ru-RU") : "—";
const fmtDM    = d  => d ? new Date(d+"T00:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"short"}) : "—"; // «18 июн.» — компактно для карточек
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
    stage:          row.stage || "В работе",
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
    // Поля v2.2 — несколько исполнителей
    executors:      Array.isArray(row.executors) ? row.executors.map(e => ({ name: e.name || "", userId: e.userId || null })) : [],
  };
}

// ВАЖНО: owner_id здесь НЕ пишется. При insert владелец добавляется явно в insertProject/
// insertProjectsBulk; при update owner_id НЕ шлётся вообще — иначе админ, правя чужой проект,
// перезаписал бы владельца на себя и «угнал» проект (баг C4).
function projectJsToDb(p) {
  return {
    name:             p.name || "Без названия",
    client:           p.client || null,
    executor:         (p.executors || []).map(e => e.name).filter(Boolean).join(", ") || null,
    executors:        (p.executors || []).filter(e => e && e.name).map(e => ({ name: e.name, userId: e.userId || null })),
    type:             p.type || null,
    stage:            p.stage || "В работе",
    start_date:       p.startDate || null,
    deadline:         p.deadline || null,
    contract_sum:     parseFloat(p.contractSum) || 0,
    notes:            p.notes || null,
    visibility:       p.visibility || "private",
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
    hasOpenQuestion: r.has_open_question ?? false,
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
// Цвета статусов задач — согласованы со STAGE_META сайта (зол./бирюза/зел.).
const TASK_STATUS_META = {
  "Новая":       { color: "#93c5fd" },
  "В работе":    { color: "#d4af37" },
  "На проверке": { color: "#2dd4bf" },
  "Готово":      { color: "#6ee7a8" },
  "Отменена":    { color: "var(--text-tertiary)" },
};
const TASK_PRIORITY_META = {
  "Высокий": { bg: "#f8a3a31f", color: "#f8a3a3", label: "🔴 Высокий" },
  "Обычный": { bg: "#d4af371f", color: "#e8c860", label: "Обычный" },
  "Низкий":  { bg: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", label: "Низкий" },
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
    userId:      row.user_id || null,
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

function shareDbToJs(row) {
  return {
    id:                row.id,
    projectId:         row.project_id,
    participantUserId: row.participant_user_id || null,
    participantClientId: row.participant_client_id || null,
    participantName:   row.participant_name || "",
    participantLabel:  row.participant_label || "",
    shareKind:         row.share_kind === "amount" ? "amount" : "percent",
    shareValue:        row.share_value != null ? Number(row.share_value) : 0,
    note:              row.note || "",
  };
}

function paymentDbToJs(row) {
  return { id: row.id, amount: Number(row.amount) || 0, paidOn: row.paid_on, note: row.note || "" };
}

// Доли всех проектов владельца (RLS вернёт только доступные). Группируем по projectId.
async function fetchProjectShares(client) {
  const { data, error } = await client.from("project_shares").select("*");
  if (error) throw error;
  const byProject = {};
  for (const row of data || []) {
    const s = shareDbToJs(row);
    (byProject[s.projectId] = byProject[s.projectId] || []).push(s);
  }
  return byProject; // { [projectId]: [share, ...] }
}

async function fetchProjectPayments(client, projectId) {
  const { data, error } = await client.from("project_payments")
    .select("id, amount, paid_on, note").eq("project_id", projectId).order("paid_on", { ascending: false });
  if (error) throw error;
  return (data || []).map(paymentDbToJs);
}
async function setProjectPayments(client, projectId, rows) {
  const payload = (rows || []).map(r => ({ amount: Number(r.amount) || 0, paid_on: r.paidOn, note: r.note || null }));
  const { error } = await client.rpc("set_project_payments", { p_project_id: projectId, p_rows: payload });
  if (error) throw error;
}

// Платежи по всем моим проектам (RLS вернёт только мои), сгруппированные по project_id.
async function fetchMyPayments(client) {
  const { data, error } = await client.from("project_payments").select("project_id, amount, paid_on");
  if (error) throw error;
  const by = {};
  for (const r of (data || [])) (by[r.project_id] ||= []).push({ amount: Number(r.amount) || 0, paidOn: r.paid_on });
  return by;
}

// Мои доли в чужих проектах (приватная проекция через RPC).
async function getMyShares(client) {
  const { data, error } = await client.rpc("get_my_shares");
  if (error) throw error;
  return (data || []).map(r => ({
    projectName:  r.project_name,
    myAmount:     Number(r.my_amount) || 0,
    myReceived:   Number(r.my_received) || 0,
    myReceivable: Number(r.my_receivable) || 0,
  }));
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
  const dbObj = { ...projectJsToDb(project), owner_id: ownerId }; // владелец задаётся только при создании
  const { data, error } = await client
    .from("projects")
    .insert(dbObj)
    .select()
    .single();
  if (error) throw error;
  return projectDbToJs(data);
}

async function updateProject(client, id, project) {
  const dbObj = projectJsToDb(project); // БЕЗ owner_id — не «угоняем» проект при правке (C4)
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
  const dbRows = projects.map(p => ({ ...projectJsToDb(p), owner_id: ownerId }));
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

// D роль заказчика (фаза 1): проекты-заказы текущего пользователя (безопасная проекция).
async function fetchMyClientProjects(client) {
  const { data, error } = await client.rpc("get_my_client_projects");
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id, name: r.name, stage: r.stage,
    startDate: r.start_date, deadline: r.deadline,
    contractSum: r.contract_sum, paidAmount: r.paid_amount, executor: r.executor,
  }));
}
async function amIClient(client) {
  const { data, error } = await client.rpc("am_i_client");
  if (error) return false;
  return !!data;
}
async function setClientUser(client, clientId, userId) {
  const { error } = await client.rpc("set_client_user", { p_client_id: clientId, p_user_id: userId });
  if (error) throw error;
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

// №10: история конкретного проекта (RPC скрывает финанс-события от не-владельца + гейт доступа)
async function fetchProjectActivity(client, projectId, limit = 100) {
  const { data, error } = await client.rpc("get_project_activity",
    { p_project_id: projectId, p_limit: limit });
  if (error) throw error;
  return data || [];
}

// №10: единый словарь лейблов журнала (DRY: админ-журнал + история проекта). Иконки — уже импортированные.
const ACTIVITY_LABELS = {
  // учётки
  user_approved:            { label: "Пользователь одобрен",  color: "#6ee7a8", Icon: UserCheck },
  user_revoked:             { label: "Доступ отозван",        color: "#f3d77b", Icon: UserMinus },
  user_deleted:             { label: "Пользователь удалён",   color: "#f8a3a3", Icon: Trash2 },
  role_changed:             { label: "Изменена роль",         color: "#d4af37", Icon: ShieldCheck },
  password_reset_by_admin:  { label: "Сброс пароля админом",  color: "#f3d77b", Icon: KeyRound },
  // проект
  project_created:          { label: "Проект создан",         color: "#6ee7a8", Icon: FolderKanban },
  project_renamed:          { label: "Проект переименован",   color: "var(--text-secondary)", Icon: Pencil },
  project_stage_changed:    { label: "Стадия изменена",       color: "#d4af37", Icon: BadgeCheck },
  project_client_changed:   { label: "Заказчик изменён",      color: "var(--text-secondary)", Icon: User },
  project_deadline_changed: { label: "Дедлайн изменён",       color: "#f3d77b", Icon: Calendar },
  project_visibility_changed:{ label: "Видимость изменена",   color: "var(--text-secondary)", Icon: Eye },
  project_executors_changed:{ label: "Исполнители изменены",  color: "var(--text-secondary)", Icon: Users },
  project_contract_changed: { label: "Сумма договора",        color: "#2dd4bf", Icon: Wallet },
  project_deleted:          { label: "Проект удалён",         color: "#f8a3a3", Icon: Trash2 },
  // деньги
  payment_added:            { label: "Платёж добавлен",       color: "#6ee7a8", Icon: Wallet },
  payment_removed:          { label: "Платёж удалён",         color: "#f8a3a3", Icon: Wallet },
  share_added:              { label: "Доля добавлена",        color: "#6ee7a8", Icon: Wallet },
  share_changed:            { label: "Доля изменена",         color: "#d4af37", Icon: Wallet },
  share_removed:            { label: "Доля удалена",          color: "#f8a3a3", Icon: Wallet },
  // команда
  member_added:             { label: "Участник добавлен",     color: "#6ee7a8", Icon: UserPlus },
  member_removed:           { label: "Участник удалён",       color: "#f8a3a3", Icon: UserMinus },
  member_role_changed:      { label: "Роль участника",        color: "#d4af37", Icon: ShieldCheck },
  // задачи
  task_created:             { label: "Задача создана",        color: "#6ee7a8", Icon: ListTodo },
  task_status_changed:      { label: "Статус задачи",         color: "#d4af37", Icon: ListTodo },
  task_assigned:            { label: "Задача назначена",      color: "var(--text-secondary)", Icon: ListTodo },
  task_deleted:             { label: "Задача удалена",        color: "#f8a3a3", Icon: Trash2 },
};

// №10: презентационная лента событий (переиспользуется админ-журналом и историей проекта)
function ActivityFeed({ items }) {
  if (!items?.length) return <Empty text="Журнал пуст" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map(a => {
        const cfg = ACTIVITY_LABELS[a.action] || { label: a.action, color: "var(--text-secondary)", Icon: Activity };
        const d = a.details || {};
        let detail = null;
        if (d.from !== undefined && d.to !== undefined) detail = `${d.from ?? "—"} → ${d.to ?? "—"}`;
        else if (d.amount != null) detail = `${Number(d.amount).toLocaleString("ru-RU")} ₽${d.paid_on ? " · " + d.paid_on : ""}`;
        else if (d.label) detail = `${d.label}${d.value != null ? " · " + d.value : ""}`;
        else if (d.name) detail = d.name;
        else if (d.title) detail = d.title;
        return (
          <div key={a.id} onMouseMove={spotlightMove} className="kp-card" style={{
            display: "flex", alignItems: "center", gap: 12, padding: "8px 14px",
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: 6, display: "inline-flex",
              alignItems: "center", justifyContent: "center",
              background: `${cfg.color}1a`, color: cfg.color, flexShrink: 0,
            }}>
              <cfg.Icon size={13} strokeWidth={2.2} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#fafaf7" }}>
                <span style={{ fontWeight: 500 }}>{cfg.label}</span>
                {detail && <span style={{ color: "var(--text-tertiary)" }}> · {detail}</span>}
                {a.target_email && <span style={{ color: "var(--text-secondary)" }}> · {a.target_email}</span>}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
                {(a.actor_email || "система")} · {new Date(a.created_at).toLocaleString("ru-RU")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
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
  // байты фото в NC чистим ДО удаления строки (каскад снесёт метаданные); best-effort
  try { await purgeTaskPhotos(client, id); } catch { /* осиротевшие байты — косметика */ }
  const { error } = await client.from("project_tasks").delete().eq("id", id);
  if (error) throw error;
}
async function notifyTask(client, type, taskId, initiatorId, extra = {}) {
  try {
    await client.functions.invoke("web-push-notify", { body: { type, taskId, initiatorId, ...extra } });
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

// ── Заход №2: фото-отчёты задач (хранение в Nextcloud, метаданные task_photos) ──
export const TASK_PHOTO_MIME = ["image/jpeg", "image/png", "image/heic", "image/webp"];
export const TASK_PHOTO_MAX = 10 * 1024 * 1024; // 10 МБ

async function fetchTaskPhotos(client, taskId) {
  const { data, error } = await client.from("task_photos")
    .select("*").eq("task_id", taskId).order("created_at");
  if (error) throw error;
  return data || [];
}

// батч для карточек доски: метаданные фото всех видимых задач одним запросом
async function fetchTaskPhotosBatch(client, taskIds) {
  if (!taskIds.length) return {};
  const { data, error } = await client.from("task_photos")
    .select("id, task_id, file_name").in("task_id", taskIds).order("created_at");
  if (error) throw error;
  const map = {};
  for (const p of data || []) (map[p.task_id] = map[p.task_id] || []).push(p);
  return map;
}

async function uploadTaskPhoto(client, taskId, file) {
  const { data, error } = await client.functions.invoke("nextcloud", {
    body: file,
    headers: {
      "x-action":    "task-photo-upload",
      "x-task-id":   taskId,
      "x-filename":  encodeURIComponent(file.name),
      "x-mime-type": file.type || "",
      "x-file-size": String(file.size),
    },
  });
  if (error) throw error;
  return data;
}

async function downloadTaskPhoto(client, photoId) {
  const { data, error } = await client.functions.invoke("nextcloud", {
    body: { action: "task-photo-download", id: photoId },
  });
  if (error) throw error;
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Blob([data]);
  if (typeof data === "string") return new Blob([data]);
  throw new Error("Не удалось получить фото");
}

async function deleteTaskPhoto(client, photoId) {
  return ncAction(client, "task-photo-delete", { id: photoId });
}

async function purgeTaskPhotos(client, taskId) {
  return ncAction(client, "task-photos-purge", { taskId });
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
  // onFocus/onBlur вызывающего НЕ глотаем (нужно автокомплитам для закрытия дропдауна)
  const { style = {}, onFocus, onBlur, ...rest } = props;
  return (
    <input
      {...rest}
      style={{
        ...BASE_INPUT,
        border: `1px solid ${focused ? "#d4af37" : "rgba(255,255,255,0.10)"}`,
        boxShadow: focused ? "0 0 0 3px rgba(212,175,55,0.18)" : "none",
        ...style,
      }}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
    />
  );
}
function StyledSelect(props) {
  const [focused, setFocused] = useState(false);
  const { style = {}, onFocus, onBlur, ...rest } = props;
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
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
    />
  );
}
function StyledTextarea(props) {
  const [focused, setFocused] = useState(false);
  const { style = {}, onFocus, onBlur, ...rest } = props;
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
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
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
  ghost: "px-4 py-2 rounded-lg border border-white/10 text-[var(--text-secondary)] hover:text-white hover:border-white/20 text-sm font-medium transition-all duration-200 active:scale-[0.98]",
  danger: "px-2 py-1 rounded text-[#62646b] hover:text-[#f8a3a3] text-sm transition-colors duration-200",
  edit: "px-2 py-1 rounded text-[#62646b] hover:text-[#d4af37] text-sm transition-colors duration-200",
};

function Label({ children }) {
  return (
    <p style={{
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: "0.10em",
      color: "var(--text-tertiary)",
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
// Spotlight: курсор → CSS-переменные --mx/--my для золотистого свечения (.kp-spotlight в index.css).
function spotlightMove(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

// 3D-tilt + spotlight для крупных карточек (Card/KpiCard). Уважает reduced-motion.
function tiltMove(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ry = (px - 0.5) * 14;
  const rx = -(py - 0.5) * 14;
  el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
}
function tiltLeave(e) {
  e.currentTarget.style.transform = "";
}

function Card({ children, style = {}, glass = false }) {
  if (glass) {
    return (
      <div
        onMouseMove={tiltMove} onMouseLeave={tiltLeave}
        className="glass-card kp-spotlight kp-hover-glow gold-ingot"
        style={{ borderRadius: 14, padding: 18, ...style }}
      >
        {children}
      </div>
    );
  }
  return (
    <div onMouseMove={tiltMove} onMouseLeave={tiltLeave} className="kp-spotlight kp-hover-glow gold-ingot" style={{
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
      {icon && <span style={{ color: "var(--text-tertiary)", display: "flex" }}>{icon}</span>}
      <p style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--text-secondary)",
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
        color: active ? "#e8c860" : "var(--text-secondary)",
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
                color: "var(--text-secondary)",
                width: 30, height: 30,
                borderRadius: 8,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.18s",
              }}
              onMouseOver={(e) => { e.currentTarget.style.color = "#f7f8f8"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseOut={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
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
    <div onMouseMove={tiltMove} onMouseLeave={tiltLeave} className="glass-card kp-spotlight kp-hover-glow gold-ingot" style={{ borderRadius: 14, padding: 16, position: "relative", overflow: "hidden" }}>
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
              fontSize: 11, color: "var(--text-tertiary)", marginTop: 6,
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
            color: "var(--text-tertiary)",
            fontWeight: 500,
            opacity: 0.6,
            marginBottom: 6,
          }}>
            Проектирование систем ОВиК<br/>Нам важно чем вы дышите.
          </div>
          <div style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
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
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.55 }}>
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

              <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-tertiary)" }}>
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
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-tertiary)", marginTop: 10 }}>
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
  const isMobile = useIsMobile(); // моб-баг #1: парные поля 1fr 1fr сворачиваем в колонку на телефоне
  const [activeTab, setActiveTab] = useState("main"); // #7: вкладки формы (main|fin|team|details)
  const [f, setF] = useState(initial ? {
    ...initial,
    shares: (initial.shares || []).map(s => ({
      participantUserId: s.participantUserId || null,
      participantClientId: s.participantClientId || null,
      participantName: s.participantName || "",
      label: s.participantName || s.participantLabel || "участник",
      shareKind: s.shareKind || "percent",
      shareValue: s.shareValue ?? "",
    })),
    // v2.2 исполнители
    executors: (initial.executors || []).map(e => ({ name: e.name || "", userId: e.userId || null })),
    // v3.0 платежи (загружаются в useEffect ниже)
    payments: [],
  } : {
    name: "", client: "", executor: "", type: "ОВиК", stage: "В работе",
    startDate: todayStr(), deadline: "", contractSum: "", paidAmount: "", notes: "",
    visibility: "private",
    // v1.2 поля
    links: [],
    clientPhone: "", clientEmail: "", clientTelegram: "",
    // v1.5 поля
    clientId: null,
    // v2.1 поля
    shares: [],
    // v2.2 поля
    executors: [],
    // v3.0 платежи
    payments: [],
    // №7: черновик команды при СОЗДАНИИ (после insert добавится в project_members)
    teamDraft: [],
  });
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));

  // №10: история действий проекта (5-я вкладка) — грузим при открытии вкладки, без realtime
  const [projActivity, setProjActivity] = useState([]);
  const [actLoading, setActLoading] = useState(false);
  useEffect(() => {
    if (activeTab !== "history" || !initial?.id || !client) return;
    let alive = true;
    setActLoading(true);
    fetchProjectActivity(client, initial.id)
      .then(rows => { if (alive) setProjActivity(rows); })
      .catch(() => { if (alive) setProjActivity([]); })
      .finally(() => { if (alive) setActLoading(false); });
    return () => { alive = false; };
  }, [activeTab, initial?.id]); // eslint-disable-line

  // №7: autocomplete команды при создании (нет project.id для прямой записи в БД)
  const [teamQuery, setTeamQuery]     = useState("");
  const [teamResults, setTeamResults] = useState([]);
  useEffect(() => {
    if (!client || !teamQuery.trim()) { setTeamResults([]); return; }
    const t = setTimeout(async () => {
      try { setTeamResults(await searchApprovedUsers(client, teamQuery)); } catch { setTeamResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [teamQuery]); // eslint-disable-line
  const addTeamDraft = (u) => setF(p => ({ ...p, teamDraft: [...(p.teamDraft || []), { userId: u.id, name: u.name || u.email, email: u.email, role: "editor" }] }));
  const removeTeamDraft = (i) => setF(p => ({ ...p, teamDraft: (p.teamDraft || []).filter((_, j) => j !== i) }));
  const setTeamDraftRole = (i, role) => setF(p => ({ ...p, teamDraft: (p.teamDraft || []).map((m, j) => j === i ? { ...m, role } : m) }));

  // v2.2: поиск исполнителей (несколько), паттерн как в TasksView
  const [execQuery, setExecQuery]     = useState("");
  const [execResults, setExecResults] = useState([]);
  // Ввод внешнего исполнителя без аккаунта
  const [execExtName, setExecExtName] = useState("");

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
  }, [execQuery]); // eslint-disable-line

  const addExecutor = (ex) => setF(p => ({ ...p, executors: [...(p.executors || []), { name: ex.name, userId: ex.userId || null }] }));
  const removeExecutor = (i) => setF(p => ({ ...p, executors: (p.executors || []).filter((_, j) => j !== i) }));

  // v2.1: автокомплит участника доли
  const [shareUserQuery, setShareUserQuery] = useState("");
  const [shareUserResults, setShareUserResults] = useState([]);
  const [shareExtName, setShareExtName] = useState("");

  useEffect(() => {
    if (!client || !shareUserQuery.trim()) { setShareUserResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchApprovedUsers(client, shareUserQuery);
      // На ЧУЖОМ проекте (я не владелец) можно назначить долю СЕБЕ — добавляем себя в
      // результаты (search_approved_users исключает self на сервере). Владелец = остаток,
      // ему добавлять себя в доли нельзя (иначе ломается расчёт остатка).
      const q = shareUserQuery.trim().toLowerCase();
      const selfMatch = profile?.id && !isOwner &&
        ((profile.name || "").toLowerCase().includes(q) || (profile.email || "").toLowerCase().includes(q));
      setShareUserResults(selfMatch && !res.some(u => u.id === profile.id)
        ? [{ id: profile.id, name: profile.name, email: profile.email }, ...res]
        : res);
    }, 300);
    return () => clearTimeout(t);
  }, [shareUserQuery]); // eslint-disable-line

  // v3.0: загрузка платежей при открытии существующего проекта.
  // paymentsReady блокирует «Сохранить», пока платежи не загрузились — иначе replace-all
  // пустым массивом сотрёт реальные платежи (race при быстром нажатии «Сохранить»).
  const [paymentsReady, setPaymentsReady] = useState(!initial?.id);
  useEffect(() => {
    if (!client || !initial?.id) return;
    fetchProjectPayments(client, initial.id)
      .then(payments => setF(p => ({ ...p, payments })))
      .catch(() => {}) // не критично — продолжим с пустым массивом
      .finally(() => setPaymentsReady(true));
  }, [initial?.id]); // eslint-disable-line

  const addShare = (part) => setF(p => ({ ...p, shares: [...(p.shares || []), {
    participantUserId: part.userId || null,
    participantClientId: part.clientId || null,
    participantName: part.name && !part.userId && !part.clientId ? part.name : "",
    label: part.name || "участник",
    shareKind: "percent", shareValue: "",
  }] }));
  const updateShare = (i, patch) => setF(p => ({ ...p, shares: p.shares.map((s, j) => j === i ? { ...s, ...patch } : s) }));
  const removeShare = (i) => setF(p => ({ ...p, shares: p.shares.filter((_, j) => j !== i) }));

  // v3.0: платежи
  const addPayment = () => setF(p => ({ ...p, payments: [...(p.payments || []), { paidOn: todayStr(), amount: "", note: "" }] }));
  const updatePayment = (i, key, val) => setF(p => ({ ...p, payments: (p.payments || []).map((r, j) => j === i ? { ...r, [key]: val } : r) }));
  const removePayment = (i) => setF(p => ({ ...p, payments: (p.payments || []).filter((_, j) => j !== i) }));

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
      {/* #7: вкладки формы — группируем ~16 блоков, чтобы не вываливать всё сразу */}
      <div style={{display:"flex",gap:4,marginBottom:16,borderBottom:"1px solid #2a2a2e",overflowX:"auto",whiteSpace:"nowrap"}}>
        {[{k:"main",l:"📋 Главное"},{k:"fin",l:"💰 Финансы"},{k:"team",l:"👥 Команда"},{k:"details",l:"💬 Детали"},...(initial?.id?[{k:"history",l:"🕘 История"}]:[])].map(t=>(
          <button key={t.k} type="button" onClick={()=>setActiveTab(t.k)} style={{
            padding:"9px 14px",fontSize:13.5,fontWeight:activeTab===t.k?700:500,cursor:"pointer",
            background:"transparent",border:"none",borderBottom:`2px solid ${activeTab===t.k?"#d4af37":"transparent"}`,
            color:activeTab===t.k?"#d4af37":"var(--text-tertiary)",whiteSpace:"nowrap",
          }}>{t.l}</button>
        ))}
      </div>
      {activeTab==="main" && (<>
      <Field label="Название проекта">
        <StyledInput value={f.name} onChange={e => s("name", e.target.value)}
          placeholder="Н-р: ОВиК Жилой дом пер. Строителей" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
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
        <div>
          <Label>Исполнители</Label>
          {/* Список добавленных исполнителей */}
          {(f.executors || []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
              {(f.executors || []).map((ex, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "rgba(255,255,255,0.05)", borderRadius: 6,
                  padding: "5px 8px", fontSize: 12,
                }}>
                  {ex.userId
                    ? <UserCheck size={12} strokeWidth={2.2} style={{ color: "#d4af37", flexShrink: 0 }} />
                    : <User size={12} strokeWidth={2.2} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                  }
                  <span style={{ color: "#fafaf7", flex: 1 }}>{ex.name}</span>
                  <button type="button" onMouseDown={() => removeExecutor(i)} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--text-tertiary)", padding: 2, display: "flex", alignItems: "center",
                  }}>
                    <X size={12} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Autocomplete — выбор из системы */}
          <div style={{ position: "relative", marginBottom: 6 }}>
            <StyledInput
              value={execQuery}
              onChange={e => setExecQuery(e.target.value)}
              onBlur={() => setTimeout(() => setExecResults([]), 200)}
              placeholder="Найти в системе..." />
            {execResults.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                background: "#1c1c1a", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8, overflow: "hidden", marginTop: 2,
              }}>
                {execResults.map(u => {
                  const alreadyAdded = (f.executors || []).some(e => e.userId === u.id);
                  return (
                    <div key={u.id}
                      onMouseDown={() => {
                        if (!alreadyAdded) {
                          addExecutor({ name: u.name || u.email, userId: u.id });
                          setExecQuery("");
                          setExecResults([]);
                        }
                      }}
                      style={{
                        padding: "8px 12px", cursor: alreadyAdded ? "default" : "pointer", fontSize: 12,
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        display: "flex", alignItems: "center", gap: 8,
                        opacity: alreadyAdded ? 0.45 : 1,
                      }}
                      onMouseOver={e => { if (!alreadyAdded) e.currentTarget.style.background = "rgba(212,175,55,0.10)"; }}
                      onMouseOut={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ color: "#fafaf7" }}>{u.name || u.email}</span>
                      {u.name && <span style={{ color: "var(--text-tertiary)" }}>{u.email}</span>}
                      {u.id === profile?.id && <span style={{ color: "#d4af37", fontSize: 11 }}>(я)</span>}
                      {alreadyAdded
                        ? <Check size={10} strokeWidth={2} style={{ marginLeft: "auto", color: "var(--text-tertiary)", flexShrink: 0 }} />
                        : <Plus size={10} strokeWidth={2.4} style={{ marginLeft: "auto", color: "#d4af37", flexShrink: 0 }} />
                      }
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* Добавить внешнего по имени (без аккаунта) */}
          <div style={{ display: "flex", gap: 6 }}>
            <StyledInput
              value={execExtName}
              onChange={e => setExecExtName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && execExtName.trim()) {
                  e.preventDefault();
                  addExecutor({ name: execExtName.trim(), userId: null });
                  setExecExtName("");
                }
              }}
              placeholder="Внешний (без аккаунта)" style={{ flex: 1 }} />
            <button type="button"
              onMouseDown={() => {
                if (execExtName.trim()) {
                  addExecutor({ name: execExtName.trim(), userId: null });
                  setExecExtName("");
                }
              }}
              style={{
                background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.3)",
                borderRadius: 7, cursor: "pointer", color: "#d4af37", padding: "0 10px",
                fontSize: 11, display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
              }}
            >
              <Plus size={11} strokeWidth={2.4} /> добавить
            </button>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
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
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><Label>Дата начала</Label>
          <StyledInput type="date" value={f.startDate} onChange={e => s("startDate", e.target.value)} /></div>
        <div><Label>Дедлайн</Label>
          <StyledInput type="date" value={f.deadline} onChange={e => s("deadline", e.target.value)} /></div>
      </div>
      </>)}
      {activeTab==="fin" && (<>
      <div style={{ marginBottom: 12 }}>
        <Label>Сумма договора (₽)</Label>
        <StyledInput type="number" value={f.contractSum} onChange={e => s("contractSum", e.target.value)} placeholder="0" />
      </div>
      {/* Платежи — отдельная секция на ВСЮ ширину (раньше были зажаты в половину сетки рядом
          с договором, и поля «сумма»/«заметка» схлопывались в нечитаемые квадраты — моб-баг #1). */}
      <div style={{ marginBottom: 14 }}>
        <Label>Платежи</Label>
        {(f.payments || []).map((pay, i) => (
          // flexWrap: на узком экране дата/сумма/заметка переносятся, а не схлопываются.
          <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <input type="date" value={pay.paidOn || ""} onChange={e => updatePayment(i, "paidOn", e.target.value)} style={{ ...BASE_INPUT, width: "auto", flex: "0 1 150px", minWidth: 130 }} />
            <StyledInput type="number" value={pay.amount} onChange={e => updatePayment(i, "amount", e.target.value)} placeholder="сумма ₽" style={{ flex: "1 1 110px", minWidth: 90 }} />
            <StyledInput value={pay.note || ""} onChange={e => updatePayment(i, "note", e.target.value)} placeholder="заметка (необязательно)" style={{ flex: "2 1 160px", minWidth: 120 }} />
            <button type="button" onClick={() => removePayment(i)} className={BTN.edit} style={{ flexShrink: 0 }} title="Удалить платёж">🗑️</button>
          </div>
        ))}
        <button type="button" onClick={addPayment} className={BTN.edit}>+ платёж</button>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
          Оплачено всего: <span style={{ color: "#6ee7a8", fontWeight: 600 }}>{fmt((f.payments || []).reduce((s, p) => s + (+p.amount || 0), 0))}</span>
        </div>
      </div>

      {/* ═══ НОВАЯ СЕКЦИЯ: Доли участников (v2.1) ═══ */}
      {(() => {
        const contractNum = Number(f.contractSum) || 0;
        const othersSum = (f.shares || []).reduce((acc, sh) => acc + (sh.shareKind === "amount"
          ? Number(sh.shareValue) || 0
          : contractNum * (Number(sh.shareValue) || 0) / 100), 0);
        const myRemainder = Math.max(0, contractNum - othersSum);
        return (
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
              Доли участников
            </div>

            {/* Список долей: первой строкой — моя доля (остаток), затем участники */}
            {(contractNum > 0 || (f.shares || []).length > 0) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {contractNum > 0 && isOwner && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center", paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontSize: 12, color: "#d4af37", fontWeight: 600, display: "flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <UserCheck size={12} strokeWidth={2.4} /> Я · остаток
                    </span>
                    <span style={{ fontSize: 12, color: othersSum > contractNum ? "#f8a3a3" : "#d4af37", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {fmt(myRemainder)} · {Math.round(myRemainder / contractNum * 100)}%
                    </span>
                  </div>
                )}
                {(f.shares || []).map((sh, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 28px", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "#fafaf7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sh.label}</span>
                    <StyledInput
                      type="number"
                      value={sh.shareValue}
                      onChange={e => updateShare(i, { shareValue: e.target.value })}
                      placeholder="0"
                      style={{ fontSize: 12, padding: "6px 10px" }}
                    />
                    <StyledSelect
                      value={sh.shareKind}
                      onChange={e => updateShare(i, { shareKind: e.target.value })}
                      style={{ fontSize: 12, padding: "6px 8px" }}
                    >
                      <option value="percent">%</option>
                      <option value="amount">₽</option>
                    </StyledSelect>
                    <button
                      type="button"
                      onClick={() => removeShare(i)}
                      style={{
                        background: "transparent", border: "none", color: "var(--text-tertiary)",
                        cursor: "pointer", padding: 4,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "color 0.18s",
                      }}
                      onMouseOver={e => e.currentTarget.style.color = "#f8a3a3"}
                      onMouseOut={e => e.currentTarget.style.color = "var(--text-tertiary)"}
                      title="Удалить долю"
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Предупреждение о превышении (моя доля показана строкой выше) */}
            {othersSum > contractNum && (
              <div style={{ fontSize: 11, color: "#f8a3a3", fontWeight: 500, marginBottom: 10 }}>
                ⚠ Доли превышают сумму договора
              </div>
            )}

            {/* Добавить: юзер-автокомплит */}
            <div style={{ marginBottom: 8 }}>
              <Label>Добавить пользователя системы</Label>
              <div style={{ position: "relative" }}>
                <StyledInput
                  value={shareUserQuery}
                  onChange={e => setShareUserQuery(e.target.value)}
                  onBlur={() => setTimeout(() => setShareUserResults([]), 200)}
                  placeholder="Поиск по имени или email…"
                  style={{ fontSize: 12 }}
                />
                {shareUserResults.length > 0 && (
                  <div style={{
                    position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                    background: "#1c1c1a", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8, overflow: "hidden", marginTop: 2,
                  }}>
                    {shareUserResults.map(u => (
                      <div key={u.id}
                        onMouseDown={() => {
                          addShare({ userId: u.id, name: u.name || u.email });
                          setShareUserQuery("");
                          setShareUserResults([]);
                        }}
                        style={{
                          padding: "8px 12px", cursor: "pointer", fontSize: 12,
                          borderBottom: "1px solid rgba(255,255,255,0.06)",
                          display: "flex", alignItems: "center", gap: 8,
                        }}
                        onMouseOver={e => e.currentTarget.style.background = "rgba(212,175,55,0.10)"}
                        onMouseOut={e => e.currentTarget.style.background = "transparent"}
                      >
                        <span style={{ color: "#fafaf7" }}>{u.name || u.email}</span>
                        {u.name && <span style={{ color: "var(--text-tertiary)" }}>{u.email}</span>}
                        <Send size={10} strokeWidth={2} style={{ marginLeft: "auto", color: "#d4af37", flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Добавить: текущий заказчик */}
            {f.clientId && f.client && (
              <div style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => addShare({ clientId: f.clientId, name: f.client })}
                  style={{
                    fontSize: 11, padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontWeight: 500,
                    background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.30)",
                    color: "#d4af37", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit",
                  }}
                >
                  <Plus size={11} strokeWidth={2.4} /> + заказчик ({f.client})
                </button>
              </div>
            )}

            {/* Добавить: внешний участник */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <StyledInput
                value={shareExtName}
                onChange={e => setShareExtName(e.target.value)}
                placeholder="Внешний участник (имя)"
                style={{ fontSize: 12, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => {
                  if (shareExtName.trim()) {
                    addShare({ name: shareExtName.trim() });
                    setShareExtName("");
                  }
                }}
                style={{
                  fontSize: 11, padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontWeight: 500,
                  background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.30)",
                  color: "#d4af37", display: "flex", alignItems: "center", gap: 4, fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                <Plus size={11} strokeWidth={2.4} /> добавить
              </button>
            </div>
          </div>
        );
      })()}
      </>)}
      {activeTab==="team" && (<>

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
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
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
      </>)}
      {activeTab==="details" && (<>

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
            fontSize: 11, color: "var(--text-tertiary)", textAlign: "center",
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
                    color: "var(--text-tertiary)",
                    cursor: "pointer",
                    padding: 4,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "color 0.18s",
                  }}
                  onMouseOver={e => e.currentTarget.style.color = "#f8a3a3"}
                  onMouseOut={e => e.currentTarget.style.color = "var(--text-tertiary)"}
                  title="Удалить ссылку"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      </>)}
      {activeTab==="main" && (<>

      <Field label="Видимость">
        <StyledSelect value={f.visibility} onChange={e => s("visibility", e.target.value)}>
          <option value="private">Личный (только я)</option>
          <option value="team">Командный (видят все одобренные)</option>
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
      </>)}
      {activeTab==="team" && (<>

      {/* ═══ СЕКЦИЯ: Команда проекта (v1.5 + №7: видна всегда, черновик при создании) ═══ */}
      {client && (
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

          {initial && initial.id ? (
            <MembersManager
              projectId={initial.id}
              profile={profile}
              client={client}
              showToast={showToast}
              canManage={isOwner || profile?.role === "admin"}
            />
          ) : (
            /* №7: при создании проекта project_members ещё нет (нет id) — собираем черновик,
               который saveProject добавит в команду сразу после создания. */
            <div>
              {(f.teamDraft || []).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  {(f.teamDraft || []).map((m, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.025)", borderRadius: 8, padding: "5px 8px" }}>
                      <UserAvatar name={m.name} email={m.email} size={24} />
                      <span style={{ flex: 1, fontSize: 12, color: "#fafaf7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                      <select value={m.role} onChange={e => setTeamDraftRole(i, e.target.value)}
                        style={{ ...BASE_INPUT, width: "auto", padding: "3px 6px", fontSize: 10, fontWeight: 600 }}>
                        <option value="viewer">Просмотр</option>
                        <option value="editor">Редактор</option>
                      </select>
                      <button type="button" onClick={() => removeTeamDraft(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 2, display: "flex" }}>
                        <X size={12} strokeWidth={2.4} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ position: "relative" }}>
                <StyledInput
                  value={teamQuery}
                  onChange={e => setTeamQuery(e.target.value)}
                  onBlur={() => setTimeout(() => setTeamResults([]), 200)}
                  placeholder="Добавить участника по имени или email…"
                  style={{ fontSize: 12 }}
                />
                {teamResults.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#1c1c1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, overflow: "hidden", marginTop: 2 }}>
                    {teamResults.map(u => {
                      const added = (f.teamDraft || []).some(m => m.userId === u.id);
                      return (
                        <div key={u.id}
                          onMouseDown={() => { if (!added) { addTeamDraft(u); setTeamQuery(""); setTeamResults([]); } }}
                          style={{ padding: "8px 12px", cursor: added ? "default" : "pointer", fontSize: 12, borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, opacity: added ? 0.45 : 1 }}>
                          <span style={{ color: "#fafaf7" }}>{u.name || u.email}</span>
                          {u.name && <span style={{ color: "var(--text-tertiary)" }}>{u.email}</span>}
                          {added
                            ? <Check size={10} strokeWidth={2} style={{ marginLeft: "auto", color: "var(--text-tertiary)" }} />
                            : <Plus size={10} strokeWidth={2.4} style={{ marginLeft: "auto", color: "#d4af37" }} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Подсказка: команда даёт доступ только при видимости «Командный» (новая модель RLS) */}
          {f.visibility !== "team" && (
            <div style={{ fontSize: 11, color: "#f3d77b", marginTop: 10, lineHeight: 1.45 }}>
              ⓘ Участники команды увидят проект только при видимости «Командный». Сейчас выбрано «{f.visibility === "marketplace" ? "Маркетплейс" : "Личный"}».
            </div>
          )}
        </div>
      )}
      </>)}
      {activeTab==="details" && (<>

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
            fontSize: 11, fontWeight: 600, color: "var(--text-secondary)",
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
            fontSize: 11, fontWeight: 600, color: "var(--text-secondary)",
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
      </>)}
      {activeTab==="history" && (<>
        {initial && initial.id
          ? (actLoading ? <Empty text="Загружаем историю…" /> : <ActivityFeed items={projActivity} />)
          : <Empty text="История доступна после сохранения проекта" />}
      </>)}
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button onClick={onClose} className={BTN.ghost} style={{ flex: 1 }} disabled={saving}>Отмена</button>
        <button onClick={() => { if(!f.name||!f.name.trim()){ setActiveTab("main"); showToast("Проверьте вкладку «Главное»: не заполнено название","error"); return; } onSave(f); }} className={BTN.primary} style={{ flex: 2, opacity: (saving || !paymentsReady) ? 0.6 : 1 }} disabled={saving || !paymentsReady}>
          {saving ? "Сохраняем..." : !paymentsReady ? "Загрузка платежей…" : "Сохранить"}
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
// ПОД-ВИДЖЕТЫ DASHBOARD (Task 9 — определения; в DOM подключаются в Task 10)
// ════════════════════════════════════════════════════════════════════════════

// Заголовок зоны дашборда
const ZONE_TITLE = (color) => ({
  fontSize: 11, fontWeight: 600, color, letterSpacing: "0.08em",
  margin: "0 0 10px", textTransform: "uppercase",
});

function ReceivablesCard({ data }) {
  const top = data.items.slice(0, 5);
  const rest = data.items.length - top.length;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <SectionTitle icon={<Wallet size={13} />}>Дебиторка · жду оплат</SectionTitle>
        <span style={{ color: "#e8c860", fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(data.total)}</span>
      </div>
      {top.length === 0
        ? <p style={{ color: "var(--text-tertiary)", fontSize: 13, margin: 0 }}>Все оплаты получены</p>
        : top.map(it => (
          <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ color: "#cdced4", fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
            <span style={{ color: "#e8c860", fontSize: 12, flexShrink: 0, marginLeft: 8, fontVariantNumeric: "tabular-nums" }}>{fmt(it.remaining)}</span>
          </div>
        ))}
      {rest > 0 && <p style={{ color: "var(--text-tertiary)", fontSize: 11, margin: "8px 0 0" }}>и ещё {rest}</p>}
    </Card>
  );
}

function MySharesCard({ shares }) {
  if (!shares || !shares.length) return null;
  const totalReceived = shares.reduce((s, x) => s + (x.myReceived || 0), 0);
  const top = [...shares].sort((a, b) => b.myReceivable - a.myReceivable).slice(0, 5);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <SectionTitle icon={<Wallet size={13} />}>Мои доли в проектах</SectionTitle>
        <span style={{ color: "#6ee7a8", fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(totalReceived)}</span>
      </div>
      {top.map((it, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <span style={{ color: "#cdced4", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.projectName}</span>
          <span style={{ color: "#e8c860", flexShrink: 0, marginLeft: 8, fontVariantNumeric: "tabular-nums" }}>{fmt(it.myReceived)} / {fmt(it.myAmount)}</span>
        </div>
      ))}
    </Card>
  );
}

const EXP_COLORS = ["#d4af37", "#93c5fd", "#f8a3a3", "#6ee7a8", "#b794f6", "var(--text-tertiary)"];

function ExpenseByCategoryCard({ data, tt }) {
  return (
    <Card>
      <SectionTitle icon={<BarChart3 size={13} />}>Расходы по категориям</SectionTitle>
      {data.length > 0
        ? <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={56} outerRadius={84} dataKey="value" nameKey="name" paddingAngle={3}>
                {data.map((e, i) => <Cell key={i} fill={EXP_COLORS[i % EXP_COLORS.length]} stroke="transparent" />)}
              </Pie>
              <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v, n) => [fmt(v), n]} />
              <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        : <Empty text="Нет расходов за период" />}
    </Card>
  );
}

function CashflowCard({ series, tt }) {
  const has = series.length > 0;
  return (
    <Card>
      <SectionTitle icon={<TrendingUp size={13} />}>Накопительный баланс</SectionTitle>
      {has
        ? <ResponsiveContainer width="100%" height={210}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#62646b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#62646b", fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={v => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}к` : v} />
              <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={v => [fmt(v), "Баланс"]} />
              <Line type="monotone" dataKey="cumBalance" stroke="#6ee7a8" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        : <Empty text="Нет данных за период" />}
    </Card>
  );
}

function MyTasksCard({ data }) {
  const today = todayStr();
  const rows = [...data.overdue, ...data.today];
  return (
    <Card>
      <SectionTitle icon={<AlertTriangle size={13} />}>
        Мои задачи · просрочено {data.counts.overdue} · сегодня {data.counts.today}
      </SectionTitle>
      {rows.length === 0
        ? <p style={{ color: "var(--text-tertiary)", fontSize: 13, margin: 0 }}>Нет горящих задач</p>
        : rows.map(t => {
          const od = t.dueDate < today;
          return (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ color: od ? "#f8a3a3" : "#f7f8f8", fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
              <span style={{ color: "var(--text-tertiary)", fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{fmtD(t.dueDate)}</span>
            </div>
          );
        })}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD — главная страница с KPI и графиками
// ════════════════════════════════════════════════════════════════════════════
function Dashboard({ projects, txs, tasks, onDrillStage, sharesByProject = {}, myShares = [], ownerId = null, paymentsByProject = {} }) {
  const [period, setPeriod] = useState("month");
  const range = periodRange(period);
  const prevRange = prevPeriodRange(period);
  const gran = granularityFor(period);

  const active = projects.filter(p => !["Оплачен", "Архив"].includes(p.stage));
  const portfolio = projects.filter(p => p.stage !== "Архив");
  const totalContract = portfolio.reduce((s, p) => s + (+p.contractSum || 0), 0);
  const totalPaid = portfolio.reduce((s, p) => s + (+p.paidAmount || 0), 0);

  // Проектные платежи (моя доля) подмешиваем к ручным txs как псевдо-доходы — чтобы
  // KPI «Доходы»/«Баланс за период» и график считались как на вкладке «Финансы».
  const allTxs = [...txs, ...projectIncomeTxs(paymentsByProject, projects, sharesByProject, ownerId)];

  const bal = periodBalance(allTxs, range);
  const prevBal = prevRange ? periodBalance(allTxs, prevRange).balance : null;
  const balanceTrend = trendDir(bal.balance, prevBal);

  const series = financeSeries(allTxs, range, gran);
  const expCats = expenseByCategory(txs, range);
  const debt = receivables(projects, sharesByProject, ownerId);
  const sharesTot = mySharesTotals(myShares);
  const myReceived = ownerReceived(projects, sharesByProject, ownerId) + sharesTot.received;
  const debtTotal = debt.total + sharesTot.receivable;
  const mineInPortfolio = portfolioMineTotal(projects, sharesByProject, ownerId, myShares); // замечание B
  const today = todayStr();
  const myT = myTasks(tasks || [], today);

  const stageData = PROJECT_STAGES.slice(0, -1)
    .map(s => ({ name: s, value: projects.filter(p => p.stage === s).length, fill: STAGE_META[s].color }))
    .filter(d => d.value > 0);

  const overdue = active.filter(p => p.deadline && p.deadline < today && p.stage !== "Сдан заказчику");
  const upcoming = active.filter(p => p.deadline && p.deadline >= today)
    .sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 4);

  const tt = {
    background: "#1c1c1a", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10,
    fontSize: 12, color: "#f7f8f8", boxShadow: "0 12px 28px rgba(0,0,0,0.5)", padding: "8px 12px",
  };

  const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.06 } } };
  const itemVariants = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } } };

  const PERIODS = [["month", "Месяц"], ["quarter", "Квартал"], ["year", "Год"], ["all", "Всё"]];

  return (
    <motion.div style={{ display: "flex", flexDirection: "column", gap: 16 }} variants={containerVariants} initial="hidden" animate="visible">

      {/* Шапка с период-селектором */}
      <motion.div variants={itemVariants} style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ display: "flex", gap: 4, background: "#1c1c1a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 3 }}>
          {PERIODS.map(([key, label]) => (
            <button key={key} onClick={() => setPeriod(key)} style={{
              border: "none", cursor: "pointer", fontSize: 12, padding: "5px 12px", borderRadius: 7,
              background: period === key ? "#d4af37" : "transparent",
              color: period === key ? "#121214" : "var(--text-secondary)",
              fontWeight: period === key ? 600 : 400,
            }}>{label}</button>
          ))}
        </div>
      </motion.div>

      {/* KPI ×4 */}
      <motion.div variants={itemVariants} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div onClick={() => onDrillStage && onDrillStage("Активные")} style={{ cursor: onDrillStage ? "pointer" : "default" }}>
          <KpiCard label="Активных проектов" value={active.length} Icon={FolderKanban} color="#d4af37" sub={`всего: ${projects.length}`} />
        </div>
        <KpiCard label="Портфель" value={totalContract} Icon={Briefcase} color="#d4af37" format={fmt} sub={`моё: ${fmt(mineInPortfolio)}`} />
        <KpiCard label="Получено" value={myReceived} Icon={BadgeCheck} color="#6ee7a8" format={fmt} sub={`жду: ${fmt(debtTotal)}`} />
        <KpiCard label="Баланс за период" value={bal.balance} Icon={Wallet} color={bal.balance >= 0 ? "#6ee7a8" : "#f8a3a3"} format={fmt} sub={`доходы ${fmt(bal.income)}`} trend={balanceTrend} />
      </motion.div>

      {/* ЗОНА: Требует внимания */}
      <motion.div variants={itemVariants}>
        <p style={ZONE_TITLE("#f8a3a3")}>⚠ Требует внимания</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <Card>
            <SectionTitle icon={<AlertTriangle size={13} />}>Просроченные дедлайны проектов</SectionTitle>
            {overdue.length === 0
              ? <p style={{ color: "var(--text-tertiary)", fontSize: 13, margin: 0 }}>Всё в срок</p>
              : overdue.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ color: "#f8a3a3", fontSize: 13, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ color: "var(--text-tertiary)", fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{fmtD(p.deadline)}</span>
                </div>
              ))}
          </Card>
          <MyTasksCard data={myT} />
        </div>
      </motion.div>

      {/* ЗОНА: Финансы */}
      <motion.div variants={itemVariants}>
        <p style={ZONE_TITLE("#e8c860")}>💰 Финансы · за выбранный период</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>
          <Card>
            <SectionTitle icon={<TrendingUp size={13} />}>Доходы и расходы</SectionTitle>
            {series.some(m => m.inc > 0 || m.exp > 0)
              ? <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={series} barSize={14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#62646b", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#62646b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}к` : v} />
                    <Tooltip cursor={{ fill: "rgba(212,175,55,0.06)" }} contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v, n) => [fmt(v), n === "inc" ? "Доходы" : "Расходы"]} />
                    <Bar dataKey="inc" name="inc" fill="#d4af37" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="exp" name="exp" fill="#f8a3a3" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              : <Empty text="Нет финансовых записей за период" />}
          </Card>
          <CashflowCard series={series} tt={tt} />
          <ExpenseByCategoryCard data={expCats} tt={tt} />
        </div>
        <ReceivablesCard data={debt} />
        <MySharesCard shares={myShares} />
      </motion.div>

      {/* ЗОНА: Проекты */}
      <motion.div variants={itemVariants}>
        <p style={ZONE_TITLE("#93c5fd")}>📁 Проекты</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <Card>
            <SectionTitle icon={<BarChart3 size={13} />}>Проекты по стадиям</SectionTitle>
            {stageData.length > 0
              ? <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie data={stageData} cx="50%" cy="50%" innerRadius={56} outerRadius={84} dataKey="value" paddingAngle={3}
                      onClick={(e) => onDrillStage && e && e.name && onDrillStage(e.name)} style={{ cursor: onDrillStage ? "pointer" : "default" }}>
                      {stageData.map((e, i) => <Cell key={i} fill={e.fill} stroke="transparent" />)}
                    </Pie>
                    <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v, n) => [`${v} проектов`, n]} />
                    <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              : <Empty text="Добавь первый проект" />}
          </Card>
          <Card>
            <SectionTitle icon={<Calendar size={13} />}>Ближайшие дедлайны</SectionTitle>
            {upcoming.length === 0
              ? <p style={{ color: "var(--text-tertiary)", fontSize: 13, margin: 0 }}>Нет запланированных дедлайнов</p>
              : upcoming.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ color: "#f7f8f8", fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ color: "#e8c860", fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{fmtD(p.deadline)}</span>
                </div>
              ))}
          </Card>
        </div>
      </motion.div>

    </motion.div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECT VISIBILITY MODAL (№9) — «глаз»: поимённо КТО и ПО КАКОЙ ПРИЧИНЕ видит проект.
// Собирает реальный список пользователей: владелец, исполнитель, команда, а для
// командных/свободно-маркетплейсных проектов — все одобренные пользователи.
// ════════════════════════════════════════════════════════════════════════════
function ProjectVisibilityModal({ project, client, profile, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const vis = project.visibility || "private";

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const members = await fetchProjectMembers(client, project.id).catch(() => []);
        // командный ИЛИ свободный маркетплейс → видят ВСЕ одобренные пользователи
        // По новой модели командный виден только команде (project_members), НЕ всем.
        // «Видят все» осталось ТОЛЬКО у свободного маркетплейса.
        const broadcast = vis === "marketplace" && !project.takenBy;
        const all = broadcast ? await searchApprovedUsers(client, "").catch(() => []) : [];
        // приоритет причины (меньше = главнее): владелец 0, исполнитель 1, команда 2, broadcast 3
        const map = new Map();
        const put = (id, name, email, reason, priority) => {
          if (!id) return;
          const ex = map.get(id);
          if (!ex || priority < ex.priority) map.set(id, { id, name, email, reason, priority });
        };
        put(project.ownerId, project.ownerId === profile?.id ? (profile.name || profile.email) : null, null, "Владелец", 0);
        if (project.takenBy) put(project.takenBy, project.executor || null, null, "Взял в работу", 1);
        for (const m of members) put(m.user_id, m.name, m.email, m.member_role === "editor" ? "Команда · редактор" : "Команда · просмотр", 2);
        if (broadcast) {
          const reason = "Маркетплейс — видят все";
          for (const u of all) put(u.id, u.name, u.email, reason, 3);
          // search_approved_users исключает самого себя — добавим текущего пользователя вручную
          if (profile?.id) put(profile.id, profile.name || profile.email, profile.email, reason, 3);
        }
        const list = [...map.values()].sort((a, b) => a.priority - b.priority);
        if (alive) setRows(list);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [project.id]); // eslint-disable-line

  const reasonColor = (p) => p === 0 ? "#d4af37" : p === 1 ? "#6ee7a8" : p === 2 ? "#93c5fd" : "var(--text-secondary)";

  return (
    <Modal title="Кто видит проект" onClose={onClose} icon={<Eye size={16} />} maxWidth={460}>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
        Проект <b style={{ color: "#fafaf7" }}>{project.name}</b>
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "12px 0" }}>Загрузка…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Проект видите только вы.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {rows.map(r => {
            const isMe = r.id === profile?.id;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <UserAvatar name={r.name} email={r.email} size={28} />
                <span style={{ fontSize: 13, color: "#fafaf7", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name || r.email || "Пользователь"}{isMe ? " · вы" : ""}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: reasonColor(r.priority), whiteSpace: "nowrap" }}>{r.reason}</span>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROJECTS — список + CRUD через Supabase
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// QUICK-EDIT (#7) — быстрое редактирование поля проекта прямо с карточки.
// Единый компонент через Portal в body (position:fixed по anchorRect — обходит
// overflow/край/скролл). mode = stage|payment|deadline|executor|team.
// На мобайле — bottom-sheet. onApplied(patch) — optimistic-апдейт карточки.
// ════════════════════════════════════════════════════════════════════════════
const QE_GOLD  = { flex:1, padding:"9px 12px", borderRadius:9, background:"#d4af37", border:"none", color:"#1c1c1a", fontWeight:800, fontSize:13, cursor:"pointer" };
const QE_GHOST = { flex:1, padding:"9px 12px", borderRadius:9, background:"#1c1c1a", border:"1px solid #2a2a2e", color:"var(--text-secondary)", fontWeight:600, fontSize:13, cursor:"pointer" };
const QE_LABEL = { fontSize:11, fontWeight:700, color:"var(--text-tertiary)", textTransform:"uppercase", letterSpacing:".1em", marginBottom:8 };

function QEStage({ project, client, onClose, onApplied, showToast }) {
  const save = async (st) => {
    if (st === project.stage) { onClose(); return; }
    onApplied({ stage: st });
    onClose();
    const { error } = await client.from("projects").update({ stage: st }).eq("id", project.id);
    if (error) { onApplied({ stage: project.stage }); showToast("Не удалось сменить стадию", "error"); }
  };
  return (
    <div>
      <div style={QE_LABEL}>Стадия</div>
      {PROJECT_STAGES.map(st => {
        const active = st === project.stage;
        const c = STAGE_META[st]?.color || "#d4af37";
        return (
          <div key={st} onClick={()=>save(st)} style={{
            display:"flex",alignItems:"center",gap:8,padding:"9px 11px",borderRadius:8,cursor:"pointer",
            background:active?"#d4af37":"transparent",color:active?"#1c1c1a":"#cfcfca",fontWeight:active?700:500,fontSize:13,
          }}
            onMouseOver={e=>{ if(!active) e.currentTarget.style.background="#2a2a2a"; }}
            onMouseOut={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}>
            <span style={{width:8,height:8,borderRadius:"50%",background:active?"#1c1c1a":c,flexShrink:0}}/>
            {st}
          </div>
        );
      })}
    </div>
  );
}

function QEDeadline({ project, client, onClose, onApplied, showToast }) {
  const [val, setVal] = useState(project.deadline || "");
  const save = async () => {
    onApplied({ deadline: val || null });
    onClose();
    const { error } = await client.from("projects").update({ deadline: val || null }).eq("id", project.id);
    if (error) { onApplied({ deadline: project.deadline }); showToast("Не удалось сменить дедлайн", "error"); }
  };
  const past = val && val < todayStr();
  return (
    <div>
      <div style={QE_LABEL}>Дедлайн</div>
      <StyledInput type="date" value={val} autoFocus onChange={e=>setVal(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") save(); }}/>
      {past && <div style={{fontSize:11,color:"#f8a3a3",marginTop:4}}>⚠ Дата в прошлом</div>}
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button onClick={onClose} style={QE_GHOST}>Отмена</button>
        <button onClick={save} style={QE_GOLD}>Сохранить</button>
      </div>
    </div>
  );
}

function QEPayment({ project, client, onClose, onApplied, showToast, onPaymentsChanged }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const amt = +amount;
    if (!amt || amt <= 0) return;
    setBusy(true);
    try {
      const existing = await fetchProjectPayments(client, project.id);
      const rows = [...existing.map(p=>({ amount:p.amount, paidOn:p.paidOn, note:p.note||"" })), { amount:amt, paidOn:date, note:"" }];
      await setProjectPayments(client, project.id, rows);
      const newPaid = rows.reduce((s,r)=>s+(+r.amount||0),0);
      onApplied({ paidAmount: newPaid });
      if (onPaymentsChanged) onPaymentsChanged(project.id, rows);
      showToast("✓ Платёж добавлен");
      onClose();
    } catch(e){ showToast("Ошибка: "+(e.message||""), "error"); }
    finally { setBusy(false); }
  };
  const disabled = busy || !(+amount > 0);
  return (
    <div>
      <div style={QE_LABEL}>Добавить платёж</div>
      <StyledInput type="number" placeholder="Сумма ₽" value={amount} autoFocus onChange={e=>setAmount(e.target.value)} style={{marginBottom:8}}/>
      <StyledInput type="date" value={date} onChange={e=>setDate(e.target.value)} style={{marginBottom:12}}/>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={QE_GHOST}>Отмена</button>
        <button onClick={add} disabled={disabled} style={{...QE_GOLD, opacity:disabled?0.5:1, cursor:disabled?"default":"pointer"}}>Добавить</button>
      </div>
    </div>
  );
}

function QEExecutor({ project, client, onClose, onApplied, showToast }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const execs = project.executors || [];
  useEffect(()=>{
    if(!q.trim()){ setRes([]); return; }
    const t = setTimeout(async()=>{ try{ setRes(await searchApprovedUsers(client, q)); }catch{ setRes([]); } }, 300);
    return ()=>clearTimeout(t);
  }, [q]); // eslint-disable-line
  const apply = async (nextExecs) => {
    const executorText = nextExecs.map(e=>e.name).filter(Boolean).join(", ") || null;
    onApplied({ executors: nextExecs, executor: executorText });
    const { error } = await client.from("projects").update({ executors: nextExecs, executor: executorText }).eq("id", project.id);
    if (error) showToast("Ошибка сохранения", "error");
  };
  const addUser = async (u) => {
    if (execs.some(e=>e.userId===u.id)) return;
    await apply([...execs, { name:u.name||u.email, userId:u.id }]);
    try { await addProjectMember(client, project.id, u.id, "editor"); } catch {}
    setQ(""); setRes([]);
  };
  const remove = async (i) => { await apply(execs.filter((_,j)=>j!==i)); };
  return (
    <div>
      <div style={QE_LABEL}>Исполнители</div>
      {execs.length>0 && (
        <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:8}}>
          {execs.map((e,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.05)",borderRadius:6,padding:"5px 8px",fontSize:12}}>
              <UserCheck size={12} strokeWidth={2.2} style={{color:"#d4af37",flexShrink:0}}/>
              <span style={{flex:1,color:"#fafaf7"}}>{e.name}</span>
              <button type="button" onClick={()=>remove(i)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--text-tertiary)",padding:2,display:"flex"}}><X size={12} strokeWidth={2.4}/></button>
            </div>
          ))}
        </div>
      )}
      <StyledInput value={q} autoFocus placeholder="Найти сотрудника…" onChange={e=>setQ(e.target.value)}/>
      {res.length>0 && (
        <div style={{marginTop:6,display:"flex",flexDirection:"column"}}>
          {res.map(u=>{
            const added = execs.some(e=>e.userId===u.id);
            return (
              <div key={u.id} onClick={()=>!added&&addUser(u)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:7,cursor:added?"default":"pointer",opacity:added?0.45:1}}
                onMouseOver={e=>{ if(!added) e.currentTarget.style.background="#2a2a2a"; }} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                <UserAvatar name={u.name} email={u.email} size={24}/>
                <span style={{fontSize:13,color:"#fafaf7"}}>{u.name||u.email}</span>
                {added ? <Check size={12} strokeWidth={2} style={{marginLeft:"auto",color:"var(--text-tertiary)"}}/> : <Plus size={12} strokeWidth={2.4} style={{marginLeft:"auto",color:"#d4af37"}}/>}
              </div>
            );
          })}
        </div>
      )}
      <button onClick={onClose} style={{...QE_GHOST, marginTop:12, width:"100%", flex:"none"}}>Готово</button>
    </div>
  );
}

function QETeam({ project, client, profile, showToast }) {
  return (
    <div>
      <div style={{...QE_LABEL, marginBottom:10}}>Команда проекта</div>
      <MembersManager projectId={project.id} profile={profile} client={client} showToast={showToast} canManage={true}/>
    </div>
  );
}

function QuickEditPortal({ project, mode, anchorRect, isMobile, client, profile, showToast, onClose, onApplied, onPaymentsChanged }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onScroll = () => onClose();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true); };
  }, [onClose]);

  const popStyle = isMobile
    ? { position:"fixed", left:0, right:0, bottom:0, zIndex:1001, background:"#1e1e20",
        borderRadius:"20px 20px 0 0", padding:"16px 16px 28px", maxHeight:"82vh", overflowY:"auto" }
    : (() => {
        const W = mode==="team" ? 340 : mode==="executor" ? 300 : 250;
        let left = anchorRect ? anchorRect.left : 100;
        if (left + W > window.innerWidth - 12) left = window.innerWidth - W - 12;
        if (left < 12) left = 12;
        const top = anchorRect ? anchorRect.bottom + 6 : 100;
        return { position:"fixed", left, top, width:W, zIndex:1001, background:"#1e1e20",
                 border:"1px solid #2a2a2e", borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,.6)",
                 padding:14, maxHeight:"70vh", overflowY:"auto" };
      })();

  return createPortal(
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:1000, background:isMobile?"rgba(0,0,0,0.6)":"transparent" }}/>
      <div style={popStyle} onClick={e=>e.stopPropagation()}>
        {isMobile && <div style={{width:40,height:4,background:"#3a3a3a",borderRadius:2,margin:"0 auto 14px"}}/>}
        {mode==="stage"    && <QEStage    project={project} client={client} onClose={onClose} onApplied={onApplied} showToast={showToast}/>}
        {mode==="deadline" && <QEDeadline project={project} client={client} onClose={onClose} onApplied={onApplied} showToast={showToast}/>}
        {mode==="payment"  && <QEPayment  project={project} client={client} onClose={onClose} onApplied={onApplied} showToast={showToast} onPaymentsChanged={onPaymentsChanged}/>}
        {mode==="executor" && <QEExecutor project={project} client={client} onClose={onClose} onApplied={onApplied} showToast={showToast}/>}
        {mode==="team"     && <QETeam     project={project} client={client} profile={profile} showToast={showToast}/>}
      </div>
    </>,
    document.body
  );
}

function Projects({ projects, setProjects, clients, client, profile, ownerId, showToast, initialStageFilter = "Активные", sharesByProject, setSharesByProject, pendingProjectId, onProjectOpened, setPaymentsByProject, onMakeReport }) {
  const [modal, setModal]             = useState(null);
  const [stageFilter, setStageFilter] = useState(initialStageFilter);
  const [confirmDel, setConfirmDel]   = useState(null);
  const [saving, setSaving]           = useState(false);
  const [selectMode, setSelectMode]   = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sortBy, setSortBy]           = useState("default"); // №4: сортировка списка проектов
  const [eyeProject, setEyeProject]   = useState(null);      // №9: «глаз» — кто видит проект
  const [adminShowAll, setAdminShowAll] = useState(false);   // админ: показать чужие личные проекты
  const isMobile = useIsMobile();
  const [activeQE, setActiveQE] = useState(null); // #7 quick-edit: {projectId, mode, rect}
  const openQE  = (e, projectId, mode) => { e.stopPropagation(); setActiveQE({ projectId, mode, rect: e.currentTarget.getBoundingClientRect() }); };
  const closeQE = () => setActiveQE(null);
  const applyQE = (id, patch) => setProjects(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));

  // Открыть карточку проекта по клику из уведомления (Центр уведомлений → onNavigate /projects/<id>).
  useEffect(() => {
    if (!pendingProjectId) return;
    const p = projects.find(x => x.id === pendingProjectId);
    if (p) { setModal(p); onProjectOpened?.(); }
  }, [pendingProjectId, projects]);

  const saveProject = async (form) => {
    setSaving(true);
    try {
      let saved;
      if (modal === "add") {
        saved = await insertProject(client, form, ownerId);
        setProjects(prev => [saved, ...prev]);
        showToast("✓ Проект создан");
        // №7: участники черновика команды → в project_members сразу после создания (+ уведомление)
        for (const m of (form.teamDraft || [])) {
          if (!m.userId) continue;
          try {
            await addProjectMember(client, saved.id, m.userId, m.role === "viewer" ? "viewer" : "editor");
            sendPush(client, "team_invite", m.userId, { projectId: saved.id, projectName: saved.name, actorName: profile?.name || profile?.email, initiatorId: profile?.id });
          } catch (e) { /* один сбойный участник не должен ронять создание проекта */ }
        }
      } else {
        saved = await updateProject(client, modal.id, form);
        setProjects(prev => prev.map(p => p.id === saved.id ? saved : p));
        showToast("✓ Проект обновлён");
      }
      // v2.2: уведомление новым исполнителям-пользователям системы
      {
        const prevExecIds = new Set(((modal !== "add" ? modal?.executors : null) || []).map(e => e.userId).filter(Boolean));
        for (const ex of (form.executors || [])) {
          if (ex.userId && !prevExecIds.has(ex.userId)) {
            // замечание C: назначенный исполнитель автоматически в команде с ролью «редактор»
            // (best-effort: дубль/недостаток прав не должны ронять сохранение проекта)
            try { await addProjectMember(client, saved.id, ex.userId, "editor"); } catch (e) { /* уже в команде или нет прав */ }
            sendPush(client, "team_invite", ex.userId, {
              projectId: saved?.id,
              projectName: saved?.name || form.name,
              actorName: profile?.name || profile?.email,
              customText: "Тебя назначили исполнителем проекта",
              initiatorId: profile?.id, // не уведомлять самого себя при self-assign
            });
          }
        }
      }
      // v2.1: сохраняем доли участников атомарно через RPC (delete+insert в одной транзакции)
      if (saved?.id) {
        const projectId = saved.id;
        const shareRows = (form.shares || [])
          .filter(sh => (Number(sh.shareValue) || 0) > 0 && (sh.participantUserId || sh.participantClientId || sh.participantName))
          .map(sh => ({
            participant_user_id: sh.participantUserId || null,
            participant_client_id: sh.participantClientId || null,
            participant_name: (!sh.participantUserId && !sh.participantClientId) ? (sh.participantName || sh.label || null) : null,
            participant_label: sh.label || null,
            share_kind: sh.shareKind === "amount" ? "amount" : "percent",
            share_value: Number(sh.shareValue) || 0,
          }));
        const { error: shErr } = await client.rpc("set_project_shares", { p_project_id: projectId, p_rows: shareRows });
        if (shErr) throw shErr;
        // Обновляем кэш долей
        if (setSharesByProject) {
          const freshShares = await fetchProjectShares(client);
          setSharesByProject(freshShares);
        }

        // v3.0: сохраняем платежи
        // При стадии «Оплачен» — если сумма платежей < суммы договора, добавляем платёж на остаток
        let paymentsToSave = [...(form.payments || [])];
        if (form.stage === "Оплачен") {
          const contractSum = Number(form.contractSum) || 0;
          const paidSum = paymentsToSave.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
          if (contractSum > 0 && paidSum < contractSum) {
            paymentsToSave = [...paymentsToSave, { paidOn: todayStr(), amount: contractSum - paidSum, note: "" }];
          }
        }
        await setProjectPayments(client, projectId, paymentsToSave);
        // Перезагружаем проекты, чтобы получить paid_amount пересчитанный триггером
        const freshProjects = await fetchProjects(client);
        setProjects(freshProjects);
        // Обновляем платежи в App-state, чтобы Finance показал свежий проектный доход без reload
        if (setPaymentsByProject) { try { setPaymentsByProject(await fetchMyPayments(client)); } catch { /* не критично */ } }
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

  const toggleSelect = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const visible = stageFilter === "Активные"
    ? projects.filter(p => !["Оплачен", "Архив"].includes(p.stage))
    : projects.filter(p => p.stage === stageFilter);

  // №4: варианты сортировки. «default» — порядок из БД (по дате создания, новые сверху).
  // Для админа добавляется «по владельцу» (группировка чужих проектов).
  const SORTS = {
    default:  { label: "Сортировка: по дате",     fn: null },
    stage:    { label: "По статусу",              fn: (a, b) => PROJECT_STAGES.indexOf(a.stage) - PROJECT_STAGES.indexOf(b.stage) },
    client:   { label: "По заказчику",            fn: (a, b) => (a.client || "").localeCompare(b.client || "", "ru") },
    deadline: { label: "По дедлайну",             fn: (a, b) => (a.deadline || "9999-99-99").localeCompare(b.deadline || "9999-99-99") },
    contract: { label: "По сумме договора",       fn: (a, b) => (+b.contractSum || 0) - (+a.contractSum || 0) },
    ...(profile?.role === "admin" ? { owner: { label: "По владельцу", fn: (a, b) => (a.ownerId || "").localeCompare(b.ownerId || "") } } : {}),
  };
  // Админ-фильтр (вариант A): по умолчанию прячем ЧУЖИЕ ЛИЧНЫЕ проекты из списка админа
  // (RLS даёт ему доступ ко всему). Чип «Все проекты (админ)» снимает фильтр.
  // Обычные пользователи отфильтрованы самой RLS — их это не касается.
  const isAdmin = profile?.role === "admin";
  const visibleForRole = (isAdmin && !adminShowAll)
    ? visible.filter(p => p.ownerId === profile.id || p.visibility !== "private")
    : visible;
  const sortFn = SORTS[sortBy]?.fn;
  const visibleSorted = sortFn ? [...visibleForRole].sort(sortFn) : visibleForRole;
  const todayS  = todayStr();

  return (
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20,alignItems:"center"}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,flex:1}}>
          {["Активные",...PROJECT_STAGES].map(s=>{
            const cnt = s==="Активные" ? projects.filter(p=>!["Оплачен","Архив"].includes(p.stage)).length : projects.filter(p=>p.stage===s).length;
            return (
              <Chip key={s}
                label={`${s}${cnt>0?` (${cnt})`:""}`}
                active={stageFilter===s} onClick={()=>setStageFilter(s)}/>
            );
          })}
          {isAdmin && (
            <Chip label={adminShowAll ? "Скрыть чужие личные" : "Все проекты (админ)"}
              active={adminShowAll} onClick={()=>setAdminShowAll(v=>!v)}/>
          )}
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          title="Сортировка проектов"
          style={{ ...BASE_INPUT, width: "auto", padding: "6px 10px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}
        >
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button
          onClick={() => { setSelectMode(m => !m); setSelectedIds(new Set()); }}
          style={{
            padding: "6px 14px", borderRadius: 8,
            border: `1px solid ${selectMode ? "rgba(110,231,168,0.40)" : "rgba(255,255,255,0.12)"}`,
            background: selectMode ? "rgba(110,231,168,0.10)" : "rgba(255,255,255,0.05)",
            color: selectMode ? "#6ee7a8" : "var(--text-secondary)",
            fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap",
          }}
        >{selectMode ? "Отмена" : "Выбрать"}</button>
        <MagneticButton onClick={()=>setModal("add")} className={BTN.primary}>+ Новый проект</MagneticButton>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {visibleSorted.length===0
          ? <Empty text={stageFilter==="Все"?"Нет проектов — нажми «Новый проект»":`Нет проектов со стадией «${stageFilter}»`}/>
          : visibleSorted.map((p,i)=>{
            const meta = STAGE_META[p.stage]||{color:"#d4af37",progress:0};
            const isAwaitingPayment = p.stage==="Сдан заказчику";
            const isOverdue = p.deadline&&p.deadline<todayS&&!["Оплачен","Архив","Сдан заказчику"].includes(p.stage);
            const paid = +p.paidAmount||0;
            const contract = +p.contractSum||0;
            const canEdit   = p.ownerId===profile?.id || profile?.role==="admin" || p.takenBy===profile?.id;
            const canManage = p.ownerId===profile?.id || profile?.role==="admin";
            return (
              <div key={p.id} onMouseMove={spotlightMove} className="kp-card kp-rise" style={{padding:16,animationDelay:`${i*40}ms`}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                  {selectMode && (
                    <div style={{paddingTop:2,flexShrink:0}} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        onClick={e => e.stopPropagation()}
                        style={{width:17,height:17,cursor:"pointer",accentColor:"#6ee7a8"}}
                      />
                    </div>
                  )}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8,marginBottom:6}}>
                      <span style={{color:"white",fontWeight:700,fontSize:15,overflowWrap:"anywhere",wordBreak:"break-word",minWidth:0}}>{p.name}</span>
                      <span onClick={canEdit?(e)=>openQE(e,p.id,"stage"):undefined}
                        style={{fontSize:11,padding:"2px 10px",borderRadius:20,fontWeight:600,
                        background:meta.color+"22",color:meta.color,cursor:canEdit?"pointer":"default",
                        border:canEdit?`1px solid ${meta.color}66`:"1px solid transparent"}}>{p.stage}{canEdit&&<span style={{marginLeft:3,fontSize:9}}>▾</span>}</span>
                      <PermissionBadge role={
                        p.ownerId === profile?.id ? "owner"
                          : profile?.role === "admin" ? "admin"
                          : p.takenBy === profile?.id ? "editor"
                          : p.visibility === "team" ? "viewer"
                          : p.visibility === "marketplace" ? "marketplace"
                          : null
                      } />
                      {isAwaitingPayment&&<span style={{fontSize:11,color:"#d4af37",fontWeight:600}}>⏳ Ожидает оплаты</span>}
                      {isOverdue&&<span style={{fontSize:11,color:"#f8a3a3",fontWeight:600}}>⚠ Просрочен</span>}
                    </div>
                    <div style={{fontSize:13,color:"var(--text-secondary)",marginBottom:10,display:"flex",flexWrap:"wrap",alignItems:"center",gap:"2px 0"}}>
                      {p.client&&<span>{p.client}</span>}
                      {p.client&&p.type&&<span style={{margin:"0 6px",color:"#1c1c1a"}}>·</span>}
                      <span style={{color:"#e8c860",fontWeight:600}}>{p.type}</span>
                      {p.executor
                        ? <><span style={{margin:"0 6px",color:"#1c1c1a"}}>·</span>
                          <span onClick={canManage?(e)=>openQE(e,p.id,"executor"):undefined} style={{color:"#d4af37",cursor:canManage?"pointer":"default"}}>👤 {p.executor}{canManage?" ▾":""}</span></>
                        : (canManage&&<><span style={{margin:"0 6px",color:"#1c1c1a"}}>·</span>
                          <span onClick={(e)=>openQE(e,p.id,"executor")} style={{color:"var(--text-tertiary)",cursor:"pointer"}}>👤 Назначить</span></>)}
                    </div>
                    <div style={{height:4,background:"#141414",borderRadius:2,overflow:"hidden",marginBottom:10}}>
                      <div style={{height:"100%",borderRadius:2,background:meta.color,
                        width:`${meta.progress}%`,transition:"width 0.5s"}}/>
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"4px 20px",fontSize:12}}>
                      {contract>0&&<span style={{color:"var(--text-secondary)"}}>Договор: <span style={{color:"#fafaf7",fontWeight:600}}>{fmt(contract)}</span></span>}
                      {paid>0
                        ? <span onClick={canManage?(e)=>openQE(e,p.id,"payment"):undefined} style={{color:"var(--text-secondary)",cursor:canManage?"pointer":"default"}}>Оплачено: <span style={{color:"#6ee7a8",fontWeight:600}}>{fmt(paid)}</span>{canManage&&<span style={{marginLeft:4,background:"#d4af37",color:"#1c1c1a",borderRadius:4,fontSize:10,fontWeight:800,padding:"0 4px"}}>+</span>}</span>
                        : (canManage&&contract>0&&<span onClick={(e)=>openQE(e,p.id,"payment")} style={{color:"var(--text-tertiary)",cursor:"pointer"}}>+ платёж</span>)}
                      {contract>0&&paid>0&&<span style={{color:"var(--text-secondary)"}}>Остаток: <span style={{color:"#d4af37",fontWeight:600}}>{fmt(contract-paid)}</span></span>}
                      {p.deadline
                        ? <span onClick={canEdit?(e)=>openQE(e,p.id,"deadline"):undefined} style={{color:"var(--text-secondary)",cursor:canEdit?"pointer":"default"}}>📅 Дедлайн: <span style={{color:isOverdue?"#f8a3a3":"#fafaf7",fontWeight:isOverdue?600:400}}>{fmtD(p.deadline)}</span>{canEdit?" ▾":""}</span>
                        : (canEdit&&<span onClick={(e)=>openQE(e,p.id,"deadline")} style={{color:"var(--text-tertiary)",cursor:"pointer"}}>📅 Срок</span>)}
                    </div>
                    {contract>0&&paid>0&&(
                      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
                        <div style={{flex:1,height:3,background:"#141414",borderRadius:2,overflow:"hidden"}}>
                          <div style={{height:"100%",background:"#6ee7a8",borderRadius:2,
                            width:`${Math.min(100,paid/contract*100)}%`}}/>
                        </div>
                        <span style={{fontSize:10,color:"var(--text-tertiary)"}}>{Math.round(paid/contract*100)}%</span>
                      </div>
                    )}
                    {/* v2.1: индикатор «Моя доля». Для владельца — его остаток; для участника-
                        зрителя — ИМЕННО его доля (раньше всем показывался остаток владельца — баг A). */}
                    {(() => {
                      const shs = (sharesByProject || {})[p.id] || [];
                      if (!shs.length) return null;
                      const mine = viewerShareOnProject(p, shs, profile?.id);
                      if (!mine) return null;
                      return (
                        <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6,fontSize:11,color:"var(--text-tertiary)"}}>
                          <Users size={12} strokeWidth={2.2}/>
                          <span>Моя доля: <span style={{color:"#e8c860",fontWeight:600}}>{fmt(mine.amount)} ({mine.percent}%)</span></span>
                        </div>
                      );
                    })()}
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
                              color: "var(--text-secondary)",
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
                              e.currentTarget.style.color = "var(--text-secondary)";
                            }}
                            title={link.url}
                          >
                            <ExternalLink size={11} strokeWidth={2.2} />
                            {link.title || "Ссылка"}
                          </a>
                        ))}
                      </div>
                    )}
                    {p.notes&&<p style={{margin:"10px 0 0",fontSize:11,color:"var(--text-tertiary)",fontStyle:"italic"}}>{p.notes}</p>}
                  </div>
                  {/* ═══ КНОПКИ ДЕЙСТВИЙ ═══ */}
                  <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,alignItems:"flex-end"}}>
                    {/* Владелец или admin: глаз видимости + редактировать + удалить + маркетплейс */}
                    {(p.ownerId===profile?.id||profile?.role==="admin")&&(
                      <>
                        <button onClick={()=>setEyeProject(p)} className={BTN.edit} title="Кто видит проект">
                          <Eye size={14} strokeWidth={2.2} />
                        </button>
                        <button onClick={(e)=>openQE(e,p.id,"team")} className={BTN.edit} title="Команда проекта">
                          <Users size={14} strokeWidth={2.2} />
                        </button>
                        <button onClick={()=>setModal(p)} className={BTN.edit}>✏️</button>
                        <button onClick={()=>{if(confirmDel===p.id){del(p.id);}else{setConfirmDel(p.id);}}}
                          style={{
                            padding:"4px 8px",borderRadius:6,border:"none",cursor:"pointer",
                            fontSize:12,fontWeight:700,transition:"all .15s",
                            background:confirmDel===p.id?"#f8a3a333":"transparent",
                            color:confirmDel===p.id?"#f8a3a3":"var(--text-tertiary)",
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
                            // executor/executors и членство в команде (editor) проставляет сам RPC take_project — атомарно
                            const executorName = profile?.name || profile?.email || "";
                            setProjects(prev=>prev.map(x=>x.id===p.id?{...x,takenBy:profile?.id,stage:"В работе",executor:executorName,executors:[...(x.executors||[]).filter(e=>e.userId!==profile?.id),{name:executorName,userId:profile?.id}]}:x));
                            showToast("✓ Проект взят в работу");
                            // Уведомление владельцу проекта
                            sendPush(client,"project_taken",p.ownerId,{
                              projectId:p.id,
                              projectName:p.name,
                              actorName:profile?.name||profile?.email,
                              initiatorId:profile?.id,
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
        {selectMode && selectedIds.size > 0 && (() => {
          const sel = projects.filter(p => selectedIds.has(p.id));
          const t = selectionTotals(sel, sharesByProject, ownerId);
          return (
            <div style={{ position: "sticky", bottom: 0, background: "#101012", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, marginTop: 12, zIndex: 30 }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8, fontSize: 13, color: "#d8d8d4" }}>
                <span>Получено: <b style={{ color: "#6ee7a8" }}>{fmt(t.received)}</b></span>
                <span>К получению: <b style={{ color: t.remaining > 0 ? "#f8a3a3" : "var(--text-tertiary)" }}>{fmt(t.remaining)}</b></span>
                <span>Сумма договоров: <b style={{ color: "#e8c860" }}>{fmt(t.contract)}</b></span>
                <span style={{ marginLeft: "auto", color: "var(--text-tertiary)" }}>выбрано: {sel.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 160, overflowY: "auto" }}>
                {t.breakdown.map(b => (
                  <div key={b.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>{b.name}</span>
                    <span style={{ color: "#6ee7a8", flexShrink: 0 }}>{fmt(b.received)}</span>
                  </div>
                ))}
              </div>
              <button onClick={()=>onMakeReport && onMakeReport(sel)} style={{
                marginTop:10,width:"100%",padding:"9px 14px",borderRadius:10,
                background:"#d4af37",border:"none",color:"#1c1c1a",
                fontSize:13,fontWeight:800,cursor:"pointer",
              }}>📄 Сформировать отчёт по выбранным ({sel.length})</button>
            </div>
          );
        })()}
      </div>

      {eyeProject && (
        <ProjectVisibilityModal project={eyeProject} client={client} profile={profile} onClose={() => setEyeProject(null)} />
      )}

      {activeQE && (() => {
        const proj = projects.find(x => x.id === activeQE.projectId);
        if (!proj) return null;
        return <QuickEditPortal project={proj} mode={activeQE.mode} anchorRect={activeQE.rect} isMobile={isMobile}
          client={client} profile={profile} showToast={showToast} onClose={closeQE}
          onApplied={(patch)=>applyQE(activeQE.projectId, patch)}
          onPaymentsChanged={(pid,rows)=>setPaymentsByProject&&setPaymentsByProject(prev=>({...prev,[pid]:rows}))}/>;
      })()}

      {modal&&(
        <Modal title={modal==="add"?"Новый проект":"Редактировать проект"} onClose={()=>!saving&&setModal(null)}>
          <ProjectForm
            initial={modal === "add" ? null : { ...modal, shares: (sharesByProject || {})[modal.id] || [] }}
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
        return <div key={i} style={{ color: "var(--text-secondary)" }}>&nbsp;&nbsp;{s.text || " "}</div>;
      })}
    </div>
  );
}

// Кэш objectURL скачанных фото (живёт сессию страницы — повторные открытия без сети).
const taskPhotoUrlCache = new Map(); // photoId -> objectURL

// Миниатюра фото задачи: лениво качает через edge, кэширует objectURL.
function TaskPhotoThumb({ photo, client, size = 64, onClick }) {
  const [url, setUrl] = useState(taskPhotoUrlCache.get(photo.id) || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (url || failed) return;
    let alive = true;
    downloadTaskPhoto(client, photo.id)
      .then(blob => {
        const u = URL.createObjectURL(blob);
        taskPhotoUrlCache.set(photo.id, u);
        if (alive) setUrl(u);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [photo.id, client, url, failed]);
  return (
    <div onClick={onClick} title={photo.file_name} style={{
      width: size, height: size, borderRadius: 8, overflow: "hidden", flexShrink: 0,
      background: "#0a0b11", border: "1px solid rgba(255,255,255,0.08)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: onClick ? "pointer" : "default",
    }}>
      {url
        ? <img src={url} alt={photo.file_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <span style={{ fontSize: size / 3, opacity: 0.4 }}>{failed ? "✕" : "🖼"}</span>}
    </div>
  );
}

// Полноэкранный просмотр фото (клик по фону или ✕ — закрыть).
// Кэша может ещё не быть (клик до загрузки миниатюры) — грузит сам.
function TaskPhotoLightbox({ photo, client, onClose }) {
  const [url, setUrl] = useState(taskPhotoUrlCache.get(photo.id) || null);
  useEffect(() => {
    if (url) return;
    let alive = true;
    downloadTaskPhoto(client, photo.id)
      .then(blob => {
        const u = URL.createObjectURL(blob);
        taskPhotoUrlCache.set(photo.id, u);
        if (alive) setUrl(u);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [photo.id, client, url]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.9)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <button onClick={onClose} style={{
        position: "absolute", top: 16, right: 20, background: "none", border: "none",
        color: "#fff", fontSize: 28, cursor: "pointer",
      }}>×</button>
      {url
        ? <img src={url} alt={photo.file_name} onClick={e => e.stopPropagation()}
               style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 8 }} />
        : <span style={{ color: "var(--text-secondary)" }}>Загрузка…</span>}
    </div>
  );
}

// Секция «Фото-отчёт» в модалке задачи: сетка миниатюр + приложить/удалить/просмотр.
function TaskPhotosSection({ task, client, profile, showToast }) {
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const fileRef = useRef(null);

  const reload = useCallback(async () => {
    try { setPhotos(await fetchTaskPhotos(client, task.id)); }
    catch (e) { showToast("Ошибка загрузки фото: " + (e.message || ""), "error"); }
  }, [client, task.id, showToast]);
  useEffect(() => { reload(); }, [reload]);

  const pick = () => fileRef.current?.click();
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // повторный выбор того же файла
    if (!file) return;
    if (!TASK_PHOTO_MIME.includes(file.type)) {
      showToast("Только фото: JPG, PNG, HEIC, WebP", "error"); return;
    }
    if (file.size > TASK_PHOTO_MAX) {
      showToast("Файл больше 10 МБ", "error"); return;
    }
    setBusy(true);
    try { await uploadTaskPhoto(client, task.id, file); await reload(); showToast("✓ Фото приложено"); }
    catch (err) { showToast("Ошибка загрузки: " + (err.message || ""), "error"); }
    finally { setBusy(false); }
  };
  const remove = async (photo) => {
    try {
      await deleteTaskPhoto(client, photo.id);
      const u = taskPhotoUrlCache.get(photo.id);
      if (u) { URL.revokeObjectURL(u); taskPhotoUrlCache.delete(photo.id); }
      await reload();
    } catch (e) { showToast("Ошибка удаления: " + (e.message || ""), "error"); }
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Label>Фото-отчёт{photos.length ? ` · ${photos.length}` : ""}</Label>
        <button onClick={pick} disabled={busy} style={{
          marginLeft: "auto", fontSize: 12, padding: "5px 10px", borderRadius: 8,
          background: "#d4af3722", border: "1px solid #d4af3744", color: "#e8c860",
          cursor: "pointer", fontWeight: 600,
        }}>{busy ? "Загрузка…" : "📷 Приложить фото"}</button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/heic,image/webp"
               onChange={onFile} style={{ display: "none" }} />
      </div>
      {photos.length === 0
        ? <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Фото пока нет</div>
        : <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {photos.map(p => (
              <div key={p.id} style={{ position: "relative" }}>
                <TaskPhotoThumb photo={p} client={client} size={72} onClick={() => setViewing(p)} />
                {p.uploaded_by === profile.id && (
                  <button onClick={() => remove(p)} title="Удалить фото" style={{
                    position: "absolute", top: -6, right: -6, width: 20, height: 20,
                    borderRadius: "50%", border: "none", cursor: "pointer",
                    background: "#1c1c1a", color: "#f8a3a3", fontSize: 12, lineHeight: 1,
                  }}>×</button>
                )}
              </div>
            ))}
          </div>}
      {viewing && <TaskPhotoLightbox photo={viewing} client={client} onClose={() => setViewing(null)} />}
    </div>
  );
}

// Контекстные кнопки workflow статусов (по таблице ролей спека).
// «Есть замечания» — обязательный текст -> комментарий в обсуждение + возврат «В работе».
function TaskWorkflowButton({ task, client, profile, showToast, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revText, setRevText] = useState("");
  if (!task.id) return null;
  const isAuthor = task.authorId === profile.id || profile.role === "admin";
  const isAssignee = task.assignedTo === profile.id || profile.role === "admin";
  // selfTask читает ДАННЫЕ задачи (автор=исполнитель), а не роли — для админа НЕ true
  const selfTask = task.authorId === task.assignedTo;

  const go = async (toStatus, extra) => {
    setBusy(true);
    try {
      await setTaskStatus(client, task.id, toStatus);
      await notifyTask(client, "task_status", task.id, profile.id, extra);
      onChanged();
    } catch (e) {
      const m = e.message || "";
      if (m.includes("only_author_can_complete")) showToast("В «Готово» переводит только автор задачи", "error");
      else showToast("Ошибка: " + m, "error");
    } finally { setBusy(false); }
  };

  const sendRevision = async () => {
    if (!revText.trim()) { showToast("Опишите замечания — поле обязательно", "error"); return; }
    setBusy(true);
    try {
      await insertTaskComment(client, task.id, "📋 Замечания по проверке:\n" + revText.trim(), false);
      await setTaskStatus(client, task.id, "В работе");
      await notifyTask(client, "task_status", task.id, profile.id,
        { customText: `↩ Проверено, есть замечания по задаче «${task.title}» — смотри ТЗ и обсуждение` });
      setRevising(false); setRevText("");
      onChanged();
    } catch (e) { showToast("Ошибка: " + (e.message || ""), "error"); }
    finally { setBusy(false); }
  };

  const big = (label, onClick, color = "#d4af37", text = "#0a0a0a") => (
    <button onClick={onClick} disabled={busy} style={{
      flex: 1, padding: "12px 16px", borderRadius: 12, border: "none", cursor: "pointer",
      background: color, color: text, fontSize: 14, fontWeight: 700,
    }}>{busy ? "…" : label}</button>
  );

  if (revising) return (
    <div style={{ marginTop: 12 }}>
      <Label>Замечания по проверке (обязательно)</Label>
      <StyledTextarea rows={3} value={revText} onChange={e => setRevText(e.target.value)}
        placeholder="Что не так и что доработать…" />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {big("Отправить замечания — вернуть в работу", sendRevision, "#e8c860")}
        <button onClick={() => { setRevising(false); setRevText(""); }} className={BTN.ghost}>Отмена</button>
      </div>
    </div>
  );

  let buttons = null;
  if (task.status === "Новая" && isAssignee) {
    buttons = big("▶ Взять в работу", () => go("В работе"));
  } else if (task.status === "В работе" && isAssignee) {
    buttons = (
      <>
        {big("📤 Отправить на проверку", () => go("На проверке"))}
        {/* «Готово» сервер разрешает ТОЛЬКО реальному автору (only_author_can_complete,
            без админ-исключения) — кнопку завершения показываем только ему */}
        {selfTask && task.authorId === profile.id && big("✓ Завершить", () => go("Готово"), "#6ee7a8")}
      </>
    );
  } else if (task.status === "На проверке" && isAuthor) {
    buttons = (
      <>
        {task.authorId === profile.id && big("✓ Принять — завершено", () => go("Готово"), "#6ee7a8")}
        {big("↩ Есть замечания", () => setRevising(true), "#e8c860")}
      </>
    );
  }
  if (!buttons) return null;
  return <div style={{ display: "flex", gap: 8, marginTop: 12 }}>{buttons}</div>;
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
        // явный whitelist полей: description версионируется отдельно (RPC),
        // status меняется через TaskWorkflowButton — здесь его не шлём.
        await updateTask(client, task.id, {
          title: form.title,
          projectId: form.projectId,
          assignedTo: form.assignedTo,
          priority: form.priority,
          dueDate: form.dueDate,
        });
        if (assigneeChanged && form.assignedTo) await notifyTask(client, "task_assigned", task.id, profile.id);
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

  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:16, background:"rgba(2,8,23,0.92)", backdropFilter:"blur(6px)" }} onClick={onClose}>
      <div style={{ background:"#141414", border:"1px solid rgba(255,255,255,0.06)", borderRadius:20, padding:24, width:"min(620px,92vw)", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 25px 60px rgba(0,0,0,.6)" }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{isNew ? "Новая задача" : form.title || "Задача"}</h3>
            {!isNew && (() => { const sm = TASK_STATUS_META[task.status] || { color: "var(--text-tertiary)" }; return (
              <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 20, background: sm.color + "1f", color: sm.color }}>{task.status}</span>
            ); })()}
            {!isNew && (() => { const pm = TASK_PRIORITY_META[task.priority] || TASK_PRIORITY_META["Обычный"]; return (
              <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 20, background: pm.bg, color: pm.color }}>{pm.label}</span>
            ); })()}
          </div>
          {!isNew && (() => { const due = dueState(task.dueDate, todayStr()); return (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
              {task.projectName ? `📁 ${task.projectName}` : "👤 Личная задача"} · исполнитель: {task.assigneeName || "—"} · автор: {task.authorName || "—"} · поставлена {fmtD((task.createdAt || "").slice(0, 10))}
              {task.dueDate && <> · срок <span style={{ color: DUE_COLORS[due.level], fontWeight: 600 }}>{fmtD(task.dueDate)} ({dueSuffix(due.days)})</span></>}
            </p>
          ); })()}
        </div>
        {!isNew && <TaskWorkflowButton task={task} client={client} profile={profile}
                     showToast={showToast} onChanged={onSaved} />}
        {!isNew && <TaskPhotosSection task={task} client={client} profile={profile} showToast={showToast} />}
        <StyledInput style={{ marginBottom: 8 }} placeholder="Заголовок"
               value={form.title} onChange={e => set("title", e.target.value)} />
        {isNew ? (
          <StyledTextarea style={{ marginBottom: 8 }} rows={4} placeholder="Описание (ТЗ)"
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
              <div style={{ background:"#0a0b11", border:"1px solid rgba(255,255,255,0.10)", borderRadius:8, padding:"10px 12px", fontSize:13, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                {currentTz || <span className="opacity-50">— ТЗ не задано —</span>}
              </div>
            )}
            {editingTz && (
              <div>
                <StyledTextarea rows={5}
                          value={tzDraft} onChange={e => setTzDraft(e.target.value)} />
                <div className="flex gap-2 mt-1">
                  <button onClick={proposeTz} disabled={tzBusy}
                          className={BTN.primary}>
                    {tzBusy ? "…" : "Предложить изменение"}</button>
                  <button onClick={() => { setEditingTz(false); setTzDraft(""); }}
                          className={BTN.ghost}>Отмена</button>
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
                    <button onClick={() => decideTz(true)} style={{ background:"#6ee7a8", color:"#0a0a0a", border:"none", borderRadius:8, padding:"6px 12px", fontWeight:700, cursor:"pointer", fontSize:13 }}>Принять</button>
                    <button onClick={() => decideTz(false)} style={{ background:"#f8a3a3", color:"#0a0a0a", border:"none", borderRadius:8, padding:"6px 12px", fontWeight:700, cursor:"pointer", fontSize:13 }}>Отклонить</button>
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
          <StyledSelect value={form.projectId} onChange={e => set("projectId", e.target.value)}>
            <option value="">Без проекта (личная)</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </StyledSelect>
          {form.assignedTo ? (
            <div style={{ ...BASE_INPUT, display:"flex", alignItems:"center", gap:8 }}>
              <span className="text-xs opacity-60 shrink-0">Исполнитель:</span>
              <span className="truncate flex-1">{assigneeName || "—"}</span>
              <button type="button" onClick={clearAssignee}
                className="text-zinc-400 hover:text-zinc-100 shrink-0" title="Сбросить исполнителя">×</button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <StyledInput placeholder="Исполнитель: поиск по имени/почте"
                value={execQuery} onChange={e => setExecQuery(e.target.value)}
                onBlur={() => setTimeout(() => setExecResults([]), 200)} />
              {execResults.length > 0 && (
                <div style={{ position:"absolute", left:0, right:0, zIndex:50, marginTop:4, background:"#141414", border:"1px solid rgba(255,255,255,0.10)", borderRadius:8, overflow:"hidden" }}>
                  {execResults.map(u => (
                    <div key={u.id} onMouseDown={() => selectAssignee(u)}
                      className="px-3 py-2 cursor-pointer text-sm hover:bg-white/5 flex items-center gap-2">
                      <span className="text-zinc-100">{u.name || u.email}</span>
                      {u.name && <span className="text-zinc-500 text-xs truncate">{u.email}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <StyledSelect value={form.priority} onChange={e => set("priority", e.target.value)}>
            {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </StyledSelect>
          <StyledInput type="date" value={form.dueDate || ""} onChange={e => set("dueDate", e.target.value)} />
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
              <StyledTextarea value={cmtText} onChange={e => setCmtText(e.target.value)} rows={2}
                        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendComment(); }}
                        placeholder="Сообщение… (Ctrl+Enter — отправить)"
                        style={{ flex:1, resize:"none", fontSize:13 }} />
              <button onClick={sendComment} disabled={cmtSending || !cmtText.trim()}
                      className={BTN.primary} style={{ whiteSpace:"nowrap" }}>
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
            {!isNew && (task.authorId === profile.id || profile.role === "admin") &&
             task.status !== "Готово" && task.status !== "Отменена" && (
              <button disabled={saving} onClick={async () => {
                setSaving(true);
                try { await setTaskStatus(client, task.id, "Отменена");
                      await notifyTask(client, "task_status", task.id, profile.id); onSaved(); }
                catch (e) { showToast("Ошибка: " + (e.message || ""), "error"); }
                finally { setSaving(false); }
              }} className={BTN.ghost}>Отменить задачу</button>
            )}
            <button onClick={onClose} className={BTN.ghost}>Отмена</button>
            <button onClick={save} disabled={saving} className={BTN.primary}>
              {saving ? "…" : "Сохранить"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Строка списка задач — те же данные, что на карточке доски, в одну плотную строку.
function TaskRowList({ t, onOpen, idx = 0 }) {
  const today = todayStr();
  const due = dueState(t.dueDate, today);
  const sm = TASK_STATUS_META[t.status] || { color: "var(--text-tertiary)" };
  const pm = TASK_PRIORITY_META[t.priority] || TASK_PRIORITY_META["Обычный"];
  return (
    <div onClick={() => onOpen(t)} onMouseMove={spotlightMove} className="kp-card kp-rise" style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      padding: "10px 14px", marginBottom: 8, cursor: "pointer",
      animationDelay: `${idx * 40}ms`,
    }}>
      <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 20, background: sm.color + "1f", color: sm.color, whiteSpace: "nowrap" }}>{t.status}</span>
      <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 20, background: pm.bg, color: pm.color, whiteSpace: "nowrap" }}>{pm.label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#f5f5f2", flex: 1, minWidth: 160 }}>{t.title}</span>
      <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{t.projectName ? `📁 ${t.projectName}` : "👤 Личная задача"}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#cfd0d4", whiteSpace: "nowrap" }}>
        <UserAvatar name={t.assigneeName} size={20} />{t.assigneeName || "—"}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>от {fmtD((t.createdAt || "").slice(0, 10))}</span>
      <span style={{ fontSize: 11.5, color: DUE_COLORS[due.level], fontWeight: due.level === "overdue" ? 700 : 400, whiteSpace: "nowrap", minWidth: 90, textAlign: "right" }}>
        {t.dueDate ? `📅 ${fmtD(t.dueDate)}${due.days !== null && t.status !== "Готово" ? ` · ${dueSuffix(due.days)}` : ""}` : "—"}
      </span>
      {t.hasOpenQuestion && <span title="есть открытый вопрос" style={{ color: "#e8c860", fontSize: 13 }}>💬</span>}
    </div>
  );
}

// Карточка задачи на доске — стиль B (мокап 2026-06-11). UserAvatar — общий компонент сайта.
function TaskCardBoard({ t, onOpen, draggable, onDragStart, photos = [], client, idx = 0 }) {
  const today = todayStr();
  const due = dueState(t.dueDate, today);
  const pm = TASK_PRIORITY_META[t.priority] || TASK_PRIORITY_META["Обычный"];
  const done = t.status === "Готово";
  return (
    <div draggable={draggable} onDragStart={onDragStart} onClick={() => onOpen(t)}
      onMouseMove={spotlightMove} className="kp-card kp-rise"
      style={{
        padding: 14, marginBottom: 11, cursor: "pointer", opacity: done ? 0.72 : 1,
        animationDelay: `${idx * 40}ms`,
      }}>
      <div style={{ marginBottom: 9 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em",
          padding: "3px 9px", borderRadius: 20, background: pm.bg, color: pm.color,
        }}>{pm.label}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: "#f5f5f2" }}>{t.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, color: "var(--text-secondary)" }}>
        {t.projectName ? <>📁 {t.projectName}</> : <>👤 Личная задача</>}
      </div>
      {t.hasOpenQuestion && (
        <div style={{
          marginTop: 10, fontSize: 11, color: "#e8c860", background: "#e8c8601a",
          border: "1px solid #e8c86033", borderRadius: 7, padding: "5px 9px",
        }}>💬 Есть вопрос</div>
      )}
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 11, alignItems: "center" }}>
          {photos.slice(0, 3).map(p => (
            <TaskPhotoThumb key={p.id} photo={p} client={client} size={46} />
          ))}
          {photos.length > 3 && (
            <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 700 }}>+{photos.length - 3}</span>
          )}
        </div>
      )}
      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "12px 0" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <UserAvatar name={t.assigneeName} size={26} />
        {/* flex:1 + minWidth:0 — имя/автор честно ужимаются в ellipsis, срок не наезжает */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#cfd0d4", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t.assigneeName || "— не назначен"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            автор: {t.authorName || "—"} · {fmtDM((t.createdAt || "").slice(0, 10))}
          </div>
        </div>
        <span style={{
          flexShrink: 0, fontSize: 11.5, whiteSpace: "nowrap",
          color: DUE_COLORS[due.level], fontWeight: due.level === "overdue" ? 700 : 400,
        }}>
          {t.dueDate ? `📅 ${fmtDM(t.dueDate)}${due.days !== null && !done ? ` · ${dueSuffix(due.days)}` : ""}` : "—"}
        </span>
      </div>
    </div>
  );
}

function TasksBoard({ tasks, onOpen, onReload, client, profile, photosByTask = {}, showToast }) {
  // колонки доски — без «Отменена» (намеренно; отменённые видны фильтром в списке)
  const cols = ["Новая", "В работе", "На проверке", "Готово"];
  const [dragId, setDragId] = useState(null);
  const move = async (taskId, toStatus) => {
    const t = tasks.find(x => x.id === taskId);
    if (!t || t.status === toStatus) return;
    // клиентское правило workflow: в «Готово» — только автор; сервер (only_author_can_complete)
    // не делает исключения и для админа — UI не предлагает то, что сервер запретит
    if (toStatus === "Готово" && t.authorId !== profile.id) {
      showToast("В «Готово» переводит только автор задачи", "error"); return;
    }
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(230px, 1fr))", gap: 14, alignItems: "start", overflowX: "auto" }}>
      {cols.map(col => {
        const meta = TASK_STATUS_META[col];
        const colTasks = tasks.filter(t => t.status === col);
        return (
          <div key={col} onDragOver={e => e.preventDefault()}
               onDrop={() => { if (dragId) move(dragId, col); setDragId(null); }}
               style={{ border: "1px solid rgba(255,255,255,0.05)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", background: meta.color + "14" }}>
              <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: meta.color }}>{col}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, borderRadius: 20, padding: "1px 9px", background: "rgba(0,0,0,0.3)", color: meta.color }}>{colTasks.length}</span>
            </div>
            <div style={{ padding: 12, background: "rgba(255,255,255,0.012)" }}>
              {colTasks.map((t, i) => (
                <TaskCardBoard key={t.id} t={t} onOpen={onOpen} client={client} idx={i}
                  photos={photosByTask[t.id] || []}
                  draggable onDragStart={() => setDragId(t.id)} />
              ))}
              <button onClick={() => onOpen({ status: col, priority: "Обычный" })} style={{
                width: "100%", textAlign: "center", background: "transparent",
                border: "1px dashed rgba(255,255,255,0.10)", color: "var(--text-tertiary)",
                borderRadius: 9, padding: 9, fontSize: 12, cursor: "pointer",
              }}>+ задача</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TasksView({ client, profile, projects, showToast }) {
  const [tasks, setTasks] = useState([]);
  const [photosByTask, setPhotosByTask] = useState({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("board"); // доска — главный вид (решение владельца)
  const [fProject, setFProject] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [fPriority, setFPriority] = useState("");
  const [sortBy, setSortBy] = useState("due"); // 'due' | 'priority' | 'created'
  const [editing, setEditing] = useState(null);
  // ref на открытую задачу: realtime-колбэк читает editingRef.current, чтобы
  // открытие/закрытие модалки не пересоздавало канал (иначе churn -> потеря событий).
  const editingRef = useRef(null);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchTasks(client, {
        projectId: fProject || null, status: view === "list" ? (fStatus || null) : null,
        assignedTo: onlyMine ? profile.id : null,
      });
      setTasks(list);
      try { setPhotosByTask(await fetchTaskPhotosBatch(client, list.map(t => t.id))); }
      catch { setPhotosByTask({}); } // миниатюры — некритичное украшение
    } catch (e) { showToast("Ошибка загрузки задач: " + (e.message || ""), "error"); }
    finally { setLoading(false); }
  }, [fProject, fStatus, onlyMine, client, profile, showToast, view]);
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
            ? { ...mapped, projectName: mapped.projectName ?? existing.projectName, assigneeName: mapped.assigneeName ?? existing.assigneeName, authorName: mapped.authorName ?? existing.authorName, hasOpenQuestion: existing.hasOpenQuestion }
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

  const today = todayStr();
  const shown = tasks.filter(t => !fPriority || t.priority === fPriority);
  const activeCount = shown.filter(t => t.status !== "Готово" && t.status !== "Отменена").length;
  const attentionCount = tasksAttention(shown, today);

  const listShown = (() => {
    let arr = shown;
    if (view === "list" && !fStatus) arr = arr.filter(t => t.status !== "Отменена");
    return arr.slice().sort((a, b) => {
      if (sortBy === "priority") return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
      if (sortBy === "created") return (b.createdAt || "").localeCompare(a.createdAt || "");
      // 'due': просроченные сверху, потом ближайшие; без срока — вниз
      const da = dueState(a.dueDate, today).days, db = dueState(b.dueDate, today).days;
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
  })();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>Задачи</h2>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-tertiary)" }}>
            {activeCount} активных{attentionCount > 0 ? ` · ${attentionCount} требуют внимания` : ""}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "inline-flex", background: "#141414", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 3, gap: 2 }}>
            {[["board", "▦ Доска"], ["list", "≣ Список"]].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} style={{
                border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 7,
                background: view === v ? "#d4af37" : "transparent", color: view === v ? "#0a0a0a" : "var(--text-secondary)",
              }}>{l}</button>
            ))}
          </div>
          <MagneticButton onClick={() => setEditing({ status: "Новая", priority: "Обычный" })} className={BTN.primary}>+ Новая задача</MagneticButton>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <StyledSelect value={fProject} onChange={e => setFProject(e.target.value)} style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}>
          <option value="">Все проекты</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </StyledSelect>
        {view === "list" && (
          <StyledSelect value={fStatus} onChange={e => setFStatus(e.target.value)} style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}>
            <option value="">Все статусы</option>
            {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </StyledSelect>
        )}
        <StyledSelect value={fPriority} onChange={e => setFPriority(e.target.value)} style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}>
          <option value="">Любой приоритет</option>
          {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </StyledSelect>
        {view === "list" && (
          <StyledSelect value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}>
            <option value="due">Сортировка: по сроку</option>
            <option value="priority">Сортировка: по приоритету</option>
            <option value="created">Сортировка: по дате постановки</option>
          </StyledSelect>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} style={{ accentColor: "#d4af37" }} /> только мои
        </label>
      </div>
      {loading ? <div className="opacity-60">Загрузка…</div> :
       view === "board" ? <TasksBoard tasks={shown} onOpen={setEditing} onReload={reload} client={client} profile={profile} photosByTask={photosByTask} showToast={showToast} /> :
       <div>
         {listShown.map((t, i) => <TaskRowList key={t.id} t={t} onOpen={setEditing} idx={i} />)}
         {!listShown.length && <div style={{ color: "var(--text-tertiary)", padding: "24px 0", textAlign: "center" }}>Задач нет</div>}
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
            {step==="preview" && <p style={{fontSize:11,color:"var(--text-tertiary)",marginTop:2}}>
              Банк: <span style={{color:"#e8c860",fontWeight:600}}>{BANK_LABELS[bank]||bank}</span>
              {" · "}{parsed.length} операций найдено
            </p>}
          </div>
          <button onClick={onClose} style={{
            background:"#141414",border:"none",color:"var(--text-secondary)",
            width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:18,
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>×</button>
        </div>

        <div style={{padding:"20px 24px"}}>
          {step==="upload" && (
            <div>
              <p style={{fontSize:13,color:"var(--text-secondary)",marginBottom:16,lineHeight:1.5}}>
                Загрузи файл выписки из банка. Поддерживаются CSV (Тинькофф, Сбер, Альфа, Яндекс)
                и PDF (Яндекс Банк). Все операции пройдут автокатегоризацию,
                и ты сможешь проверить и подправить категории перед импортом.
              </p>
              <input ref={fileRef} type="file" accept=".csv,.pdf" onChange={handleFile} style={{display:"none"}}/>
              <button onClick={()=>fileRef.current?.click()} disabled={pdfLoading} style={{
                width:"100%",padding:"32px 16px",borderRadius:14,
                background:"#141414",border:"2px dashed #1c1c1a",
                color:pdfLoading?"var(--text-tertiary)":"#fafaf7",fontSize:14,fontWeight:600,
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
                  <div style={{fontSize:10,color:"var(--text-tertiary)",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em"}}>{s.label}</div>
                  <div style={{fontSize:18,fontWeight:900,color:s.color,marginTop:2}}>{s.val}</div>
                </div>
              ))}
            </div>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:11,color:"var(--text-tertiary)",fontWeight:600}}>
                Нажми на название чтобы отредактировать. ✂ — автоочистка длинного текста.
              </div>
              <button
                onClick={()=>setEdited(e=>e.map(r=>({...r,description:cleanDesc(r.description)})))}
                style={{
                  background:"#141414",border:"1px solid #2d3f55",borderRadius:8,
                  color:"var(--text-secondary)",fontSize:11,fontWeight:700,cursor:"pointer",
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
                    <span style={{fontSize:11,color:"var(--text-tertiary)",whiteSpace:"nowrap"}}>{fmtD(row.date)}</span>
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
                            color:"var(--text-tertiary)",fontSize:11,cursor:"pointer",
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
                color:"var(--text-secondary)",fontSize:14,fontWeight:600,cursor:"pointer",
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
              <div style={{fontSize:13,color:"var(--text-tertiary)",marginBottom:24}}>
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
function Finance({ txs, setTxs, client, ownerId, showToast, projects = [], sharesByProject = {}, myShares = [], paymentsByProject = {} }) {
  const isMobile = useIsMobile(); // моб: пироги/гриды сворачиваем в колонку на телефоне
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
  const projIncomeMonth = myProjectIncomeForMonth(paymentsByProject, projects, sharesByProject, ownerId, monthF);
  const incTotal = inc + projIncomeMonth;

  // Сводка «по проектам» (read-only): получено и к получению по МОЕЙ доле — теми же
  // расчётами, что и дашборд. У paidAmount нет даты платежа → показываем «всего»,
  // вне помесячного фильтра ручного кошелька (отдельный блок, не смешиваем с txs).
  const projReceived   = ownerReceived(projects, sharesByProject, ownerId) + mySharesTotals(myShares).received;
  const projReceivable = receivables(projects, sharesByProject, ownerId).total + mySharesTotals(myShares).receivable;

  const expByCat = EXPENSE_CATS
    .map(c=>({name:c,value:filtered.filter(t=>t.type==="expense"&&t.category===c).reduce((s,t)=>s+(+t.amount||0),0)}))
    .filter(d=>d.value>0);
  const incByCat = INCOME_CATS
    .map(c=>({name:c,value:filtered.filter(t=>t.type==="income"&&t.category===c).reduce((s,t)=>s+(+t.amount||0),0)}))
    .filter(d=>d.value>0);
  const incByCatFull = projIncomeMonth > 0 ? [...incByCat, { name: "Проектные доходы", value: projIncomeMonth }] : incByCat;

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
        <MagneticButton onClick={()=>setModal("add")} className={BTN.primary} style={{marginLeft:"auto"}}>
          + Добавить запись
        </MagneticButton>
        <button onClick={()=>setCsvModal(true)} style={{
          fontSize:12,padding:"7px 12px",borderRadius:8,cursor:"pointer",fontWeight:600,
          background:"#6ee7a822",border:"1px solid #6ee7a844",color:"#6ee7a8",flexShrink:0,
        }}>
          📂 Импорт CSV
        </button>
      </div>

      {(projReceived > 0 || projReceivable > 0) && (
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle>💼 По проектам · моя доля (всего)</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ textAlign: "center" }}>
              <Label>Получено по проектам</Label>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#6ee7a8", marginTop: 4 }}>{fmt(projReceived)}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <Label>К получению</Label>
              <div style={{ fontSize: 16, fontWeight: 900, color: projReceivable > 0 ? "#f8a3a3" : "var(--text-tertiary)", marginTop: 4 }}>{fmt(projReceivable)}</div>
            </div>
          </div>
        </Card>
      )}

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
        {[
          {label:"Доходы",val:incTotal,color:"#e8c860"},
          {label:"Расходы",val:exp,color:"#f8a3a3"},
          {label:"Баланс",val:incTotal-exp,color:incTotal>=exp?"#6ee7a8":"#f8a3a3"},
        ].map(r=>(
          <Card key={r.label} style={{textAlign:"center"}}>
            <Label>{r.label}</Label>
            <div style={{fontSize:16,fontWeight:900,color:r.color,marginTop:4}}>{fmt(r.val)}</div>
          </Card>
        ))}
      </div>

      {(incByCatFull.length>0||expByCat.length>0)&&(
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:16,marginBottom:16}}>
          {incByCatFull.length>0&&(
            <Card>
              <SectionTitle>Источники доходов</SectionTitle>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={incByCatFull} cx="50%" cy="40%" innerRadius={30} outerRadius={52} dataKey="value" paddingAngle={2}>
                    {incByCatFull.map((_,i)=><Cell key={i} fill={PALETTE[i%PALETTE.length]} stroke="transparent"/>)}
                  </Pie>
                  <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v,n)=>[fmt(v),n]}/>
                  <Legend iconType="circle" iconSize={7} verticalAlign="bottom" wrapperStyle={{paddingTop:6,fontSize:10,lineHeight:"15px"}} formatter={v=><span style={{fontSize:10,color:"var(--text-secondary)"}}>{v}</span>}/>
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}
          {expByCat.length>0&&(
            <Card>
              <SectionTitle>Структура расходов</SectionTitle>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={expByCat} cx="50%" cy="40%" innerRadius={30} outerRadius={52} dataKey="value" paddingAngle={2}>
                    {expByCat.map((_,i)=><Cell key={i} fill={PALETTE[i%PALETTE.length]} stroke="transparent"/>)}
                  </Pie>
                  <Tooltip contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v,n)=>[fmt(v),n]}/>
                  <Legend iconType="circle" iconSize={7} verticalAlign="bottom" wrapperStyle={{paddingTop:6,fontSize:10,lineHeight:"15px"}} formatter={v=><span style={{fontSize:10,color:"var(--text-secondary)"}}>{v}</span>}/>
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
            <div key={t.id} onMouseMove={spotlightMove} className="kp-card" style={{
              padding:"12px 16px",display:"flex",alignItems:"center",gap:12,
            }}>
              <div style={{width:4,height:36,borderRadius:2,flexShrink:0,
                background:t.type==="income"?"#d4af37":"#f8a3a3"}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:"#fafaf7",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {t.description||t.category}
                </div>
                <div style={{fontSize:11,color:"var(--text-tertiary)",marginTop:2}}>{t.category} · {fmtD(t.date)}</div>
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
                  color:confirmDel===t.id?"#f8a3a3":"var(--text-tertiary)",
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
// ANALYTICS
// ════════════════════════════════════════════════════════════════════════════
function Analytics({ projects, txs, sharesByProject = {}, ownerId = null, paymentsByProject = {} }) {
  const now = new Date();
  // Проектные платежи (моя доля) как псевдо-доходы — баланс по месяцам как в «Финансах».
  const allTxs = [...txs, ...projectIncomeTxs(paymentsByProject, projects, sharesByProject, ownerId)];
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
    const inc = allTxs.filter(t=>t.type==="income"&&t.date.startsWith(k)).reduce((s,t)=>s+(+t.amount||0),0);
    const exp = allTxs.filter(t=>t.type==="expense"&&t.date.startsWith(k)).reduce((s,t)=>s+(+t.amount||0),0);
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
              <XAxis type="number" tick={{fill:"var(--text-tertiary)",fontSize:10}} axisLine={false} tickLine={false}
                tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}к`:v}/>
              <YAxis type="category" dataKey="name" tick={{fill:"var(--text-secondary)",fontSize:11}} width={165} axisLine={false} tickLine={false}/>
              <Tooltip cursor={{ fill: "rgba(212,175,55,0.06)" }} contentStyle={tt} itemStyle={{ color: "#fafaf7" }} formatter={(v,n)=>[fmt(v),n==="contract"?"Договор":"Оплачено"]}/>
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
              <XAxis dataKey="label" tick={{fill:"var(--text-tertiary)",fontSize:10}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:"var(--text-tertiary)",fontSize:10}} axisLine={false} tickLine={false}
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
                <div style={{width:160,textAlign:"right",fontSize:12,color:"var(--text-secondary)",fontWeight:500}}>{stage}</div>
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
      color: "var(--text-tertiary)",
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
        <Inbox size={22} strokeWidth={1.6} style={{ color: "var(--text-tertiary)" }} />
      </div>
      <p style={{ fontSize: 13, margin: 0, color: "var(--text-secondary)" }}>{text}</p>
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
        initiatorId: profile?.id, // не уведомлять автора о собственном комментарии
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
            <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{fmtDT(c.createdAt)}</span>
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
            margin: 0, fontSize: 13, color: "var(--text-secondary)",
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
                fontSize: 11, color: "var(--text-tertiary)", padding: 0,
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
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 10px" }}>Загрузка…</p>
      ) : open.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 10px" }}>Пока нет комментариев</p>
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
            color: text.trim() ? "#0a0a0a" : "var(--text-tertiary)",
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
              color: "var(--text-tertiary)", fontSize: 11, padding: 0,
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
  return <FileText size={14} strokeWidth={2} style={{ color: "var(--text-secondary)" }} />;
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
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-tertiary)", marginBottom: 4 }}>
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
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 8px" }}>Загрузка…</p>
      ) : files.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 8px" }}>Файлов пока нет</p>
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
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 1 }}>
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
                    color: "var(--text-secondary)", padding: 4, lineHeight: 1,
                    transition: "color 0.15s",
                  }}
                  onMouseOver={e => e.currentTarget.style.color = "#d4af37"}
                  onMouseOut={e => e.currentTarget.style.color = "var(--text-secondary)"}
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
                      color: f.is_public ? "#6ee7a8" : "var(--text-tertiary)", padding: 4, lineHeight: 1,
                      transition: "color 0.15s",
                    }}
                    onMouseOver={e => e.currentTarget.style.color = "#d4af37"}
                    onMouseOut={e => e.currentTarget.style.color = f.is_public ? "#6ee7a8" : "var(--text-tertiary)"}
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
                      color: "var(--text-tertiary)", padding: 4, lineHeight: 1,
                      transition: "color 0.15s",
                    }}
                    onMouseOver={e => e.currentTarget.style.color = "#f8a3a3"}
                    onMouseOut={e => e.currentTarget.style.color = "var(--text-tertiary)"}
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
          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Публичный</span>
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
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
        projectId,
        actorName: profile?.name || profile?.email,
        initiatorId: profile?.id,
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
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontStyle: "italic", textAlign: "center", padding: "12px 0" }}>
        Команду можно настроить после первого сохранения проекта
      </div>
    );
  }

  return (
    <div>
      {loading ? (
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", textAlign: "center", padding: "10px 0" }}>Загружаем...</div>
      ) : members.length === 0 && !adding ? (
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", textAlign: "center", padding: "8px 0", fontStyle: "italic" }}>
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
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                      background: "transparent", border: "none", color: "var(--text-tertiary)",
                      cursor: "pointer", padding: 4, display: "flex",
                    }}
                    onMouseOver={e => e.currentTarget.style.color = "#f8a3a3"}
                    onMouseOut={e => e.currentTarget.style.color = "var(--text-tertiary)"}
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
                        <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{u.email}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selectedUser && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Роль:</span>
                  {["viewer", "editor"].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelectedRole(r)}
                      style={{
                        padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontSize: 10, fontWeight: 600,
                        background: selectedRole === r ? "rgba(212,175,55,0.20)" : "transparent",
                        border: `1px solid ${selectedRole === r ? "rgba(212,175,55,0.40)" : "rgba(255,255,255,0.10)"}`,
                        color: selectedRole === r ? "#d4af37" : "var(--text-secondary)",
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
                    color: "var(--text-secondary)", cursor: "pointer", fontSize: 11, fontFamily: "inherit",
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
function ClientForm({ initial, onSave, onClose, saving, client, showToast, onLinked }) {
  const isMobile = useIsMobile(); // моб: парные поля 1fr 1fr сворачиваем в колонку на телефоне
  const [f, setF] = useState(initial || {
    name: "", phone: "", email: "", telegram: "",
    clientType: "individual", category: "regular",
    legalName: "", inn: "", address: "", city: "", notes: "",
  });
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));

  // D роль заказчика: привязка аккаунта к этой записи (только для существующей записи).
  const [linkedUserId, setLinkedUserId] = useState(initial?.userId || null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState([]);
  useEffect(() => {
    if (!client || !linkQuery.trim()) { setLinkResults([]); return; }
    const t = setTimeout(async () => {
      try { setLinkResults(await searchApprovedUsers(client, linkQuery)); } catch { setLinkResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [linkQuery]); // eslint-disable-line
  const doLink = async (user) => {
    if (!initial?.id) return;
    try {
      await setClientUser(client, initial.id, user ? user.id : null);
      setLinkedUserId(user ? user.id : null);
      setLinkOpen(false); setLinkQuery(""); setLinkResults([]);
      onLinked && onLinked(user ? user.id : null);
    } catch (e) { showToast && showToast("Ошибка: " + (e.message || ""), "error"); }
  };

  return (
    <div>
      <Field label="Имя клиента *">
        <StyledInput value={f.name} onChange={e => s("name", e.target.value)}
          placeholder="ФИО или название организации" autoFocus />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
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
          fontSize: 11, fontWeight: 600, color: "var(--text-secondary)",
          textTransform: "uppercase", letterSpacing: "0.10em",
          marginBottom: 12,
        }}>
          <Building2 size={12} strokeWidth={2.4} /> Реквизиты <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>(необязательно)</span>
        </div>
        <Field label="Юридическое название">
          <StyledInput value={f.legalName} onChange={e => s("legalName", e.target.value)}
            placeholder='ООО "Стройинвест"' />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
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

      {initial?.id && (
      <Field label="Доступ заказчика (аккаунт)">
        {linkedUserId ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#6ee7a8" }}>✓ аккаунт привязан</span>
            <button type="button" className={BTN.ghost} onClick={() => doLink(null)}>Отвязать</button>
          </div>
        ) : linkOpen ? (
          <div>
            <StyledInput value={linkQuery} onChange={e => setLinkQuery(e.target.value)}
              placeholder="Поиск пользователя по имени/email…" autoFocus />
            {linkResults.length > 0 && (
              <div style={{ marginTop: 6, border: "1px solid #2a2a2e", borderRadius: 8, overflow: "hidden" }}>
                {linkResults.map(u => (
                  <button key={u.id} type="button" onClick={() => doLink(u)} style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                    background: "transparent", border: "none", color: "#fafaf7", cursor: "pointer", fontSize: 13 }}>
                    {u.name || u.email} <span style={{ color: "var(--text-tertiary)" }}>· {u.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button type="button" className={BTN.ghost} onClick={() => setLinkOpen(true)}>Привязать аккаунт</button>
        )}
      </Field>
      )}

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
// CLIENT ORDERS — раздел "Мои заказы" (D роль заказчика, фаза 1, read-only проекция)
// ════════════════════════════════════════════════════════════════════════════
function ClientOrdersPage({ orders }) {
  if (!orders?.length) return <Empty text="Заказов пока нет" />;
  const money = n => (Number(n) || 0).toLocaleString("ru-RU");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {orders.map(o => (
        <div key={o.id} style={{ padding: "14px 16px", borderRadius: 12, background: "#141414",
          border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#fafaf7" }}>{o.name}</span>
            <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20,
              background: "rgba(212,175,55,0.15)", color: "#d4af37" }}>{o.stage}</span>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10, fontSize: 13, color: "var(--text-secondary)" }}>
            <span>Договор: <b style={{ color: "#fafaf7" }}>{money(o.contractSum)} ₽</b></span>
            <span>Оплачено: <b style={{ color: "#6ee7a8" }}>{money(o.paidAmount)} ₽</b></span>
            <span>Остаток: <b style={{ color: "#f3d77b" }}>{money((o.contractSum || 0) - (o.paidAmount || 0))} ₽</b></span>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 6, fontSize: 12, color: "var(--text-tertiary)" }}>
            {o.deadline && <span>Срок: {o.deadline}</span>}
            {o.executor && <span>Исполнитель: {o.executor}</span>}
          </div>
        </div>
      ))}
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
            color: "var(--text-tertiary)", pointerEvents: "none",
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
        <MagneticButton onClick={() => setModal("add")} className={BTN.primary} style={{ marginLeft: "auto" }}>
          + Новый клиент
        </MagneticButton>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {visible.length === 0 ? (
          <Empty text={
            clients.length === 0
              ? "Пока нет клиентов — нажми «Новый клиент»"
              : "Никто не подходит под фильтр"
          } />
        ) : visible.map((c, i) => (
          <div key={c.id} onMouseMove={spotlightMove} className="kp-card kp-rise" style={{
            padding: 16,
            animationDelay: `${i * 40}ms`,
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
                    <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontWeight: 600 }}>· Архив</span>
                  )}
                </div>
                {c.legalName && (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>{c.legalName}</div>
                )}
                {(c.city || c.address) && (
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 11, color: "var(--text-secondary)" }}>
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
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontStyle: "italic", marginTop: 8 }}>{c.notes}</div>
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
                    color: confirmDel === c.id ? "#f8a3a3" : "var(--text-tertiary)",
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
            client={client}
            showToast={showToast}
            onLinked={(uid) => {
              if (modal && modal.id) {
                setClients(prev => prev.map(x => x.id === modal.id ? { ...x, userId: uid } : x));
                setModal(m => (m && m.id) ? { ...m, userId: uid } : m);
                showToast(uid ? "Аккаунт привязан" : "Аккаунт отвязан");
              }
            }}
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
  const [position, setPosition]  = useState(profile?.position || "");
  const [saving, setSaving]      = useState(false);
  // Режим высокого контраста — per-device (localStorage), не в аккаунте: зависит от экрана.
  const [hc, setHc] = useState(() => { try { return localStorage.getItem("kp-hc") === "1"; } catch { return false; } });
  const toggleHc = () => {
    const v = !hc; setHc(v);
    try { document.documentElement.classList.toggle("hc", v); localStorage.setItem("kp-hc", v ? "1" : "0"); } catch {}
  };

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

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await client
        .from("profiles")
        .update({ name: name.trim() || null, position: position.trim() || null })
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
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
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
          {position && <div style={{ fontSize: 11.5, color: "#d4af37", marginTop: 2, fontWeight: 500 }}>{position}</div>}
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{profile?.email}</div>
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
      {/* Должность — необязательное поле, показывается в карточке профиля */}
      <Field label="Должность">
        <StyledInput
          value={position}
          onChange={e => setPosition(e.target.value)}
          placeholder="Например: Главный инженер"
          onKeyDown={e => { if (e.key === "Enter") save(); }}
        />
      </Field>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 16, lineHeight: 1.5 }}>
        Имя и должность видят другие участники команды. Email и роль изменить нельзя.
      </div>

      {/* ── Высокий контраст (этого устройства) ──────────────────────────── */}
      <div style={{
        marginBottom: 16, padding: "12px 14px", borderRadius: 10,
        background: "var(--gold-bg-subtle)", border: "1px solid var(--border-gold-subtle)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>Высокий контраст</span>
          <button onClick={toggleHc} aria-pressed={hc} style={{
            width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
            transition: "all 0.2s", padding: 0, flexShrink: 0,
            background: hc ? "#d4af37" : "rgba(255,255,255,0.10)", position: "relative",
          }}>
            <span style={{
              position: "absolute", top: 2, left: hc ? 18 : 2,
              width: 16, height: 16, borderRadius: "50%", background: "#fafaf7", transition: "left 0.2s",
            }} />
          </button>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "8px 0 0", lineHeight: 1.5 }}>
          Если интерфейс выглядит тускло или блёкло (часто на Android-экранах) — включите. Настройка действует только на этом устройстве.
        </p>
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
          <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
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
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
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
          textTransform: "uppercase", marginBottom: 8, color: "var(--text-tertiary)",
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
              color: section === s.id ? "#d4af37" : "var(--text-secondary)",
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
                color: "var(--text-tertiary)", pointerEvents: "none",
              }} />
              <StyledInput
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по email или имени..."
                style={{ paddingLeft: 36 }}
              />
            </div>
            {!loading && (
              <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-secondary)" }}>
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
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>{u.email}</div>
                    <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
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
                          color: u.approved ? "var(--text-secondary)" : "#6ee7a8",
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
                          color: u.role === "admin" ? "#d4af37" : "var(--text-secondary)",
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
                          color: "var(--text-secondary)", display: "flex",
                        }}
                        onMouseOver={e => { e.currentTarget.style.color = "#e8c860"; e.currentTarget.style.borderColor = "rgba(212,175,55,0.30)"; }}
                        onMouseOut={e => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
                      >
                        <KeyRound size={13} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() => { setConfirmDel(u.id); setConfirmText(""); }}
                        title="Удалить пользователя"
                        style={{
                          padding: 6, borderRadius: 6, cursor: "pointer", border: "1px solid",
                          background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.10)",
                          color: "var(--text-secondary)", display: "flex",
                        }}
                        onMouseOver={e => { e.currentTarget.style.color = "#f8a3a3"; e.currentTarget.style.borderColor = "rgba(248,163,163,0.30)"; }}
                        onMouseOut={e => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
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
                { label: "В архиве",             value: stats.projects_archived,  Icon: Package,      color: "var(--text-tertiary)" },
                { label: "Сумма портфеля",       value: stats.portfolio_total,    Icon: Briefcase,    color: "#d4af37", format: fmt },
                { label: "Получено по портфелю", value: stats.portfolio_paid,     Icon: BadgeCheck,   color: "#6ee7a8", format: fmt },
                { label: "Транзакций всего",     value: stats.transactions_total, Icon: Receipt,      color: "var(--text-secondary)" },
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
          {loading ? <Empty text="Загружаем..." /> : <ActivityFeed items={activity} />}
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
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, marginTop: 0 }}>
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
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, marginTop: 0 }}>
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
// Модальное окно с двумя инструментами:
//   1. Экспорт текущих данных в JSON (надёжный — через textarea, не window.open)
//   2. Импорт из JSON-бэкапа (вставка в textarea)
function BackupPanel({ projects, txs, client, ownerId, onImported, onClose, showToast, paymentsByProject = {}, sharesByProject = {} }) {
  const [tab, setTab] = useState("export");        // export | import
  const [importJson, setImportJson] = useState("");
  const [busy, setBusy] = useState(false);

  // C5: бэкап теперь включает платежи и доли (раньше терялись → «Оплачено» обнулялось при импорте).
  const exportJson = JSON.stringify({
    version: 3,
    exportedAt: new Date().toISOString(),
    projects,
    txs,
    payments: paymentsByProject, // { [projectId]: [{ amount, paidOn }] }
    shares: sharesByProject,     // { [projectId]: [share...] }
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
      // C5: восстановить платежи и доли. Проекты создаются с НОВЫМИ id → маппим старый id
      // проекта (data.projects[i].id) на новый (insertedP[i].id) по позиции (bulk insert
      // сохраняет порядок VALUES). Best-effort: сбой одного проекта не рушит весь импорт.
      let restoredPay = 0, restoredSh = 0;
      for (let i = 0; i < data.projects.length; i++) {
        const oldId = data.projects[i]?.id;
        const newId = insertedP[i]?.id;
        if (!oldId || !newId) continue;
        const pays = (data.payments || {})[oldId];
        if (Array.isArray(pays) && pays.length) {
          try {
            await setProjectPayments(client, newId, pays.map(p => ({ amount: p.amount, paidOn: p.paidOn, note: p.note || "" })));
            restoredPay++;
          } catch (e) { /* не критично */ }
        }
        const shs = (data.shares || {})[oldId];
        if (Array.isArray(shs) && shs.length) {
          const rows = shs.map(s => ({
            participant_user_id: s.participantUserId || null,
            participant_client_id: s.participantClientId || null,
            participant_name: (!s.participantUserId && !s.participantClientId) ? (s.participantName || null) : null,
            participant_label: s.participantLabel || s.participantName || null,
            share_kind: s.shareKind === "amount" ? "amount" : "percent",
            share_value: Number(s.shareValue) || 0,
          })).filter(r => r.share_value > 0);
          if (rows.length) {
            try { await client.rpc("set_project_shares", { p_project_id: newId, p_rows: rows }); restoredSh++; } catch (e) { /* не критично */ }
          }
        }
      }
      onImported(insertedP, insertedT);
      const extra = (restoredPay || restoredSh) ? ` (платежи: ${restoredPay}, доли: ${restoredSh})` : "";
      showToast(`✓ Импортировано: проектов ${insertedP.length}, транзакций ${insertedT.length}${extra}`);
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
        ].map(t => (
          <Chip key={t.id} label={t.label} active={tab===t.id} onClick={()=>setTab(t.id)}/>
        ))}
      </div>

      {tab === "export" && (
        <div>
          <p style={{fontSize:13,color:"var(--text-secondary)",marginBottom:12,lineHeight:1.5}}>
            Все твои проекты ({projects.length}) и транзакции ({txs.length}) в формате JSON,
            включая платежи и доли участников. Скопируй текст ниже и сохрани в файл — это твоя страховка.
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
          <p style={{fontSize:13,color:"var(--text-secondary)",marginBottom:12,lineHeight:1.5}}>
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

    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT VIEWER (тот же что в v1, без существенных изменений)
// ════════════════════════════════════════════════════════════════════════════
// Насыщенные цвета стадий для СВЕТЛОЙ печатной темы (контраст текста на белом).
const REPORT_STAGE_COLOR = {
  "Поиск исполнителя":"#3b6fb0","В работе":"#b08900","Сдан заказчику":"#0a8f5b",
  "Оплачен":"#0a8f5b","Архив":"#555",
};

// Таблица отчёта (ПК). isClient прячет колонки «Оплачено»/«Остаток».
function ReportTable({ projects, isClient, fmtDeadline }) {
  const cols = isClient
    ? ["Проект / Клиент","Тип работ","Исполнитель","Стадия","По договору","Дедлайн"]
    : ["Проект / Клиент","Тип работ","Исполнитель","Стадия","По договору","Оплачено","Остаток","Дедлайн"];
  return (
    <div style={{background:"#fff",borderRadius:14,border:"1px solid #e6e9ee",overflow:"hidden",marginBottom:18}}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead>
          <tr style={{background:"#f0f3f7"}}>
            {cols.map((h,i)=>(
              <th key={h} style={{padding:"10px 14px",fontSize:9.5,fontWeight:700,textTransform:"uppercase",
                letterSpacing:".1em",color:"#5b626d",borderBottom:"2px solid #e6e9ee",
                textAlign:i>=4?"right":"left"}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.map((p,i)=>{
            const contract=+p.contractSum||0,paid=+p.paidAmount||0,debt=contract-paid;
            const c=REPORT_STAGE_COLOR[p.stage]||"#b08900";
            return (
              <tr key={p.id} style={{background:i%2===0?"#fff":"#fafbfc"}}>
                <td style={{padding:"10px 14px",borderBottom:"1px solid #eef1f4"}}>
                  <div style={{fontWeight:700,color:"#0a0a0a",fontSize:13}}>{p.name}</div>
                  {p.client&&<div style={{color:"#5b626d",fontSize:11,marginTop:1}}>{p.client}</div>}
                </td>
                <td style={{padding:"10px 14px",borderBottom:"1px solid #eef1f4",fontSize:12,color:"#404040"}}>{p.type||"—"}</td>
                <td style={{padding:"10px 14px",borderBottom:"1px solid #eef1f4",fontSize:12,color:"#404040"}}>{p.executor||"—"}</td>
                <td style={{padding:"10px 14px",borderBottom:"1px solid #eef1f4"}}>
                  <span style={{display:"inline-block",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:c+"1f",color:c}}>{p.stage}</span>
                </td>
                <td style={{padding:"10px 14px",borderBottom:"1px solid #eef1f4",textAlign:"right",fontWeight:600,color:"#0a0a0a",fontSize:13}}>{contract>0?fmt(contract):"—"}</td>
                {!isClient&&<td style={{padding:"10px 14px",borderBottom:"1px solid #eef1f4",textAlign:"right",fontWeight:700,color:"#0a8f5b",fontSize:13}}>{paid>0?fmt(paid):"—"}</td>}
                {!isClient&&<td style={{padding:"10px 14px",borderBottom:"1px solid #eef1f4",textAlign:"right",fontWeight:700,fontSize:13,color:debt>0?"#cc3333":"#0a8f5b"}}>{contract>0?(debt>0?fmt(debt):"✓"):"—"}</td>}
                <td style={{padding:"10px 14px",borderBottom:"1px solid #eef1f4",textAlign:"right",fontSize:12,color:"#5b626d"}}>{fmtDeadline(p.deadline)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Карточки отчёта (телефон). Каждый проект — карточка «поле: значение».
function ReportCards({ projects, isClient, fmtDeadline }) {
  const Row = ({ label, value, color }) => (
    <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12.5,padding:"3px 0"}}>
      <span style={{color:"#5b626d"}}>{label}</span>
      <span style={{color:color||"#1c1c1a",fontWeight:600,textAlign:"right"}}>{value}</span>
    </div>
  );
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:18}}>
      {projects.map(p=>{
        const contract=+p.contractSum||0,paid=+p.paidAmount||0,debt=contract-paid;
        const c=REPORT_STAGE_COLOR[p.stage]||"#b08900";
        return (
          <div key={p.id} style={{background:"#fff",borderRadius:12,border:"1px solid #e6e9ee",padding:"12px 14px"}}>
            <div style={{fontWeight:800,color:"#0a0a0a",fontSize:14}}>{p.name}</div>
            {p.client&&<div style={{color:"#5b626d",fontSize:12}}>{p.client}</div>}
            <div style={{marginTop:8,borderTop:"1px solid #eef1f4",paddingTop:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,fontSize:12.5,padding:"3px 0"}}>
                <span style={{color:"#5b626d"}}>Стадия</span>
                <span style={{display:"inline-block",padding:"1px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:c+"1f",color:c}}>{p.stage}</span>
              </div>
              <Row label="Тип" value={p.type||"—"}/>
              <Row label="Исполнитель" value={p.executor||"—"}/>
              <Row label="По договору" value={contract>0?fmt(contract):"—"}/>
              {!isClient&&<Row label="Оплачено" value={paid>0?fmt(paid):"—"} color="#0a8f5b"/>}
              {!isClient&&<Row label="Остаток" value={contract>0?(debt>0?fmt(debt):"✓"):"—"} color={debt>0?"#cc3333":"#0a8f5b"}/>}
              <Row label="Дедлайн" value={fmtDeadline(p.deadline)}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Презентационный документ отчёта — ЕДИНЫЙ источник для экрана и печати.
// Только JSX (React экранирует текст) → XSS невозможен (раньше был innerHTML).
function ReportDocument({ projects, mode, dateStr, sourceLabel, isMobile }) {
  const isClient = mode === "client";
  const totalContract = projects.reduce((s,p)=>s+(+p.contractSum||0),0);
  const totalPaid     = projects.reduce((s,p)=>s+(+p.paidAmount||0),0);
  const totalDebt     = totalContract - totalPaid;
  const fmtDeadline = (d)=> d ? new Date(d+"T00:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"short"}) : "—";

  const kpis = isClient
    ? [{l:"Сумма договоров",v:fmt(totalContract),c:"#bcd3ff"}]
    : [
        {l:"Сумма договоров",v:fmt(totalContract),c:"#bcd3ff"},
        {l:"Получено",       v:fmt(totalPaid),     c:"#7ef0c0"},
        {l:"К получению",    v:fmt(totalDebt),     c:totalDebt>0?"#ffb0b0":"#7ef0c0"},
        {l:"% оплаты",       v:`${totalContract>0?Math.round(totalPaid/totalContract*100):0}%`, c:"#fff"},
      ];

  return (
    <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",background:"#f4f6f9",
                 minHeight:"100%",padding:isMobile?"18px 12px":"28px 24px",
                 WebkitPrintColorAdjust:"exact",printColorAdjust:"exact"}}>
      <div style={{maxWidth:1050,margin:"0 auto"}}>

        <div style={{background:"linear-gradient(135deg,#0a0a0a,#1c1c1a)",borderRadius:16,
                     padding:isMobile?"20px 18px":"28px 36px",color:"#fff",marginBottom:18}}>
          <div style={{fontSize:isMobile?18:21,fontWeight:900,letterSpacing:"-.02em",marginBottom:4}}>
            <span style={{color:"#d4af37"}}>КЛИМАТ-ПРО</span> — Отчёт по проектам
          </div>
          <div style={{fontSize:12.5,opacity:.72}}>Сформирован {dateStr} · {sourceLabel} · {projects.length} проектов</div>
          <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":`repeat(${kpis.length},minmax(120px,1fr))`,gap:10,marginTop:16}}>
            {kpis.map(k=>(
              <div key={k.l} style={{background:"rgba(255,255,255,.12)",borderRadius:12,padding:"11px 16px"}}>
                <div style={{fontSize:9.5,opacity:.72,textTransform:"uppercase",letterSpacing:".1em",fontWeight:700}}>{k.l}</div>
                <div style={{fontSize:isMobile?16:19,fontWeight:900,color:k.c,marginTop:4}}>{k.v}</div>
              </div>
            ))}
          </div>
        </div>

        {projects.length===0
          ? <div style={{textAlign:"center",padding:48,color:"#8a8f98",fontSize:14}}>Нет проектов</div>
          : isMobile
            ? <ReportCards projects={projects} isClient={isClient} fmtDeadline={fmtDeadline}/>
            : <ReportTable projects={projects} isClient={isClient} fmtDeadline={fmtDeadline}/>}

        {projects.some(p=>p.notes)&&(
          <div style={{background:"#fff",borderRadius:12,border:"1px solid #e6e9ee",padding:"16px 20px",marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:"#5b626d",textTransform:"uppercase",letterSpacing:".1em",marginBottom:10}}>Примечания</div>
            {projects.filter(p=>p.notes).map(p=>(
              <div key={p.id} style={{marginBottom:6,fontSize:13,color:"#1c1c1a"}}>
                <b>{p.name}:</b> <span style={{color:"#404040"}}>{p.notes}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{textAlign:"center",fontSize:12,color:"#9aa1ab",paddingBottom:16}}>КЛИМАТ-ПРО · {dateStr}</div>
      </div>
    </div>
  );
}

function ReportViewer({ projects, onClose, presetProjects = null }) {
  const isMobile = useIsMobile();
  const [stage, setStage] = useState("all");
  const [mode, setMode] = useState("full");        // full | client
  const [showPreview, setShowPreview] = useState(false);

  const stages = ["all", ...PROJECT_STAGES.filter(s => s !== "Архив")];
  const labels  = {"all":"Все активные",...Object.fromEntries(PROJECT_STAGES.map(s=>[s,s]))};

  const visible = presetProjects
    ? presetProjects
    : (stage === "all" ? projects.filter(p => p.stage !== "Архив") : projects.filter(p => p.stage === stage));

  const dateStr     = new Date().toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"});
  const sourceLabel = presetProjects ? "Выбранные проекты" : labels[stage];

  // @media print: печатаем ТОЛЬКО область отчёта (тот же React-DOM), без innerHTML-дубля.
  useEffect(() => {
    const id = "report-print-style";
    if (document.getElementById(id)) return;
    const st = document.createElement("style");
    st.id = id;
    st.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #report-print-area, #report-print-area * { visibility: visible !important; }
        #report-print-area { position: absolute !important; left: 0; top: 0; width: 100%; }
        .report-no-print { display: none !important; }
      }
    `;
    document.head.appendChild(st);
    return () => { const el=document.getElementById(id); if(el) el.remove(); };
  }, []);

  if (showPreview) return (
    <div style={{position:"fixed",inset:0,zIndex:200,background:"#f4f6f9",overflowY:"auto"}}>
      <div className="report-no-print" style={{
        position:"sticky",top:0,zIndex:10,background:"#1c1c1a",padding:isMobile?"10px 14px":"10px 24px",
        display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,boxShadow:"0 2px 12px rgba(0,0,0,.3)"
      }}>
        <button onClick={()=>setShowPreview(false)} style={{
          padding:"8px 14px",borderRadius:8,background:"rgba(255,255,255,.12)",border:"none",
          color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer"
        }}>← Назад</button>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {!isMobile&&<span style={{fontSize:12,color:"#9aa1ab"}}>или Ctrl/Cmd+P</span>}
          <button onClick={()=>window.print()} style={{
            padding:"8px 16px",borderRadius:8,background:"#d4af37",border:"none",
            color:"#1c1c1a",fontWeight:800,fontSize:13,cursor:"pointer"
          }}>🖨 Печать / Сохранить PDF</button>
        </div>
      </div>
      <div id="report-print-area">
        <ReportDocument projects={visible} mode={mode} dateStr={dateStr} sourceLabel={sourceLabel} isMobile={isMobile}/>
      </div>
    </div>
  );

  return (
    <Modal title="📄 Экспорт отчёта" onClose={onClose} maxWidth={460}>
      <p style={{fontSize:13,color:"var(--text-secondary)",marginBottom:16,lineHeight:1.6}}>
        {presetProjects
          ? `Отчёт по выбранным проектам (${presetProjects.length}). Нажми «Открыть», затем «Печать / Сохранить PDF».`
          : "Отчёт откроется здесь. Нажми «Печать / Сохранить PDF» — браузер сохранит документ для отправки заказчику."}
      </p>

      <div style={{marginBottom:16}}>
        <p style={{fontSize:10,fontWeight:700,color:"var(--text-tertiary)",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8}}>Вид отчёта</p>
        <div style={{display:"flex",gap:6}}>
          {[{k:"full",l:"Полный"},{k:"client",l:"Для заказчика"}].map(o=>(
            <button key={o.k} onClick={()=>setMode(o.k)} style={{
              flex:1,padding:"8px 12px",borderRadius:10,fontSize:12.5,fontWeight:700,cursor:"pointer",
              background:mode===o.k?"#d4af37":"#141414",
              color:mode===o.k?"#1c1c1a":"#cfcfca",
              border:`1px solid ${mode===o.k?"#d4af37":"rgba(255,255,255,0.10)"}`,transition:"all .15s",
            }}>{o.l}</button>
          ))}
        </div>
        <p style={{fontSize:11,color:"var(--text-tertiary)",marginTop:6,lineHeight:1.4}}>
          {mode==="client" ? "Без «Оплачено» и «Остаток» — только договор, стадии и сроки." : "Все финансы: договор, оплачено, остаток, % оплаты."}
        </p>
      </div>

      {!presetProjects && (
        <div style={{marginBottom:16}}>
          <p style={{fontSize:10,fontWeight:700,color:"var(--text-tertiary)",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8}}>Фильтр по стадии</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {stages.map(s=>(
              <button key={s} onClick={()=>setStage(s)} style={{
                padding:"5px 12px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
                background:stage===s?"#d4af37":"#141414",
                color:stage===s?"#1c1c1a":"var(--text-secondary)",
                border:`1px solid ${stage===s?"#d4af37":"rgba(255,255,255,0.08)"}`,transition:"all .15s",
              }}>{labels[s]}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{
        padding:"12px 16px",background:"#141414",borderRadius:12,marginBottom:16,
        display:"flex",justifyContent:"space-between",alignItems:"center",
      }}>
        <span style={{fontSize:13,color:"var(--text-secondary)"}}>Проектов в отчёте</span>
        <span style={{fontSize:18,fontWeight:900,color:"#e8c860"}}>{visible.length}</span>
      </div>
      <button onClick={()=>setShowPreview(true)} style={{
        width:"100%",padding:14,borderRadius:14,background:"#d4af37",border:"none",
        color:"#1c1c1a",fontSize:15,fontWeight:800,cursor:"pointer",
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
  const [pendingStageFilter, setPendingStageFilter] = useState("Активные");
  const [pendingProjectId, setPendingProjectId] = useState(null); // открыть проект по клику из уведомления
  const [projects, setProjects]     = useState([]);
  const [txs, setTxs]               = useState([]);
  const [tasks, setTasks]           = useState([]);
  const [sharesByProject, setSharesByProject] = useState({});
  const [myShares, setMyShares]     = useState([]);
  const [paymentsByProject, setPaymentsByProject] = useState({});
  const [clients, setClients]       = useState([]); // v1.5
  const [clientProjects, setClientProjects] = useState([]); // D роль заказчика: мои заказы
  const [hasClientRole, setHasClientRole]   = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false); // Cmd+K командная палитра
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K" || e.key === "л" || e.key === "Л")) {
        e.preventDefault(); setCmdOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [reportModal, setReportModal] = useState(false);
  const [reportProjects, setReportProjects] = useState(null); // null = все/фильтр по стадии; массив = отчёт по выбранным
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
            const [p, t, cl, tk, sh, ms, pb, cp, icr] = await Promise.all([
              fetchProjects(supabase).catch(() => []),
              fetchTransactions(supabase).catch(() => []),
              fetchClients(supabase).catch(() => []),
              fetchTasks(supabase, { assignedTo: prof.id }).catch(() => []),
              fetchProjectShares(supabase).catch(() => ({})),
              getMyShares(supabase).catch(() => []),
              fetchMyPayments(supabase).catch(() => ({})),
              fetchMyClientProjects(supabase).catch(() => []),
              amIClient(supabase).catch(() => false),
            ]);
            setProjects(p);
            setTxs(t);
            setClients(cl);
            setTasks(tk);
            setSharesByProject(sh);
            setMyShares(ms);
            setPaymentsByProject(pb);
            setClientProjects(cp);
            setHasClientRole(icr);
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
        setTasks([]);
        setClients([]);
        setSharesByProject({});
        setMyShares([]);
        setPaymentsByProject({});
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
      const [p, t, cl, tk, sh, ms, pb, cp, icr] = await Promise.all([
        fetchProjects(supabase),
        fetchTransactions(supabase),
        fetchClients(supabase).catch(() => []),
        fetchTasks(supabase, { assignedTo: prof.id }).catch(() => []),
        fetchProjectShares(supabase).catch(() => ({})),
        getMyShares(supabase).catch(() => []),
        fetchMyPayments(supabase).catch(() => ({})),
        fetchMyClientProjects(supabase).catch(() => []),
        amIClient(supabase).catch(() => false),
      ]);
      setProjects(p);
      setTxs(t);
      setClients(cl);
      setTasks(tk);
      setSharesByProject(sh);
      setMyShares(ms);
      setPaymentsByProject(pb);
      setClientProjects(cp);
      setHasClientRole(icr);
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
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
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
      <BackgroundCanvas />
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
    ...(hasClientRole ? [{ id: "myorders", label: "Мои заказы", Icon: Package }] : []),
    { id: "finance",   label: "Финансы",   Icon: Receipt },
    { id: "analytics", label: "Аналитика", Icon: BarChart3 },
    ...(profile?.role === "admin" ? [{ id: "admin", label: "Admin", Icon: ShieldCheck }] : []),
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "transparent",
      color: "#f7f8f8",
      fontFamily: "'Geist Variable', system-ui, -apple-system, sans-serif",
    }}>
      <BackgroundCanvas />

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)}
        projects={projects} tasks={tasks} orders={clientProjects} hasClientRole={hasClientRole}
        onNavigate={(it) => {
          if (it.kind === "section") setTab(it.id);
          else if (it.kind === "project") { setPendingProjectId(it.id); setTab("projects"); }
          else if (it.kind === "task") setTab("tasks");
          else if (it.kind === "order") setTab("myorders");
        }} />

      {/* Вся верхняя зона (шапка + вкладки) прилипает как единый блок — top вкладок
          больше не зависит от переменной высоты шапки (фикс «вкладки уезжают под шапку»). */}
      <div style={{ position: "sticky", top: 0, zIndex: 50 }}>

      {/* Шапка с логотипом, действиями и информацией о пользователе */}
      <div style={{
        padding: isMobile ? "12px 14px" : "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        background: "linear-gradient(180deg, rgba(10,10,12,0.72) 0%, rgba(10,10,12,0.36) 60%, rgba(10,10,12,0) 100%)",
        backdropFilter: "blur(14px) saturate(1.3)",
        WebkitBackdropFilter: "blur(14px) saturate(1.3)",
      }}>
        {/* Логотип */}
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div className="brand-breathe" style={{
            width: 40, height: 40, flex: "0 0 auto",
            display: "grid", placeItems: "center", borderRadius: 12,
            background: "radial-gradient(120% 120% at 30% 20%, rgba(232,200,96,0.20), rgba(212,175,55,0.05))",
            border: "1px solid rgba(212,175,55,0.40)",
          }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="url(#kpg)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <defs><linearGradient id="kpg" x1="0" y1="0" x2="24" y2="24">
                <stop offset="0" stopColor="#f6e7a8"/><stop offset="0.6" stopColor="#d4af37"/><stop offset="1" stopColor="#9c7c22"/>
              </linearGradient></defs>
              <path d="M3 12a4 4 0 0 1 4-4h9a3 3 0 1 0-3-3"/>
              <path d="M3 17h13a3 3 0 1 1-3 3"/>
              <path d="M3 7h4"/>
            </svg>
          </div>
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
            <span className="brand-shimmer">КЛИМАТ-ПРО</span>
            <span style={{
              color: "var(--text-tertiary)",
              fontWeight: 400,
              fontSize: 13,
            }}>· Искусство климата, инженерия комфорта</span>
          </h1>
          <div style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            fontWeight: 500,
            opacity: 0.6,
            marginTop: 2,
          }}>Проектирование систем ОВиК<br/>Нам важно чем вы дышите.</div>
          </div>
        </div>

        {/* Правая часть: кнопки действий и информация о пользователе */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: isMobile ? "flex-start" : "flex-end", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
            {/* Бейдж командной палитры — открывает CommandPalette (хоткей Ctrl/Cmd+K) */}
            <div className="cmdk-badge" onClick={() => setCmdOpen(true)} title="Поиск и команды (Ctrl+K)">
              {!isMobile && <span>Поиск</span>}
              <kbd>⌘K</kbd>
            </div>
            {/* Колокольчик Центра уведомлений */}
            <NotificationBell
              client={supabase}
              userId={profile?.id}
              showToast={showToast}
              isMobile={isMobile}
              onNavigate={(url) => {
                if (!url) return;
                if (url.startsWith("/tasks")) setTab("tasks");
                else if (url.startsWith("/projects/")) { setPendingProjectId(url.split("/")[2]); setTab("projects"); }
              }}
            />
            {/* Кнопка отчёта — акцентная, в фирменном цвете */}
            <button
              onClick={() => { setReportProjects(null); setReportModal(true); }}
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
                color: "var(--text-secondary)",
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
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginLeft: 4 }}>
              {new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
            </div>
            <button
              onClick={() => location.reload()}
              title={"Версия сборки: " + __BUILD_ID__ + "\nНажмите, чтобы загрузить актуальную версию"}
              style={{
                fontSize: 9, color: "var(--text-quaternary)", marginLeft: 2, padding: "1px 6px",
                background: "none", border: "1px solid transparent", borderRadius: 5, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: "0.02em", lineHeight: 1.2, transition: "all .18s",
                whiteSpace: "nowrap",
              }}
              onMouseOver={e => { e.currentTarget.style.color = "var(--gold)"; e.currentTarget.style.borderColor = "var(--border-gold-subtle)"; }}
              onMouseOut={e => { e.currentTarget.style.color = "var(--text-quaternary)"; e.currentTarget.style.borderColor = "transparent"; }}
            >
              v{__BUILD_ID__}
            </button>
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
              <span style={{ width: 19, height: 19, borderRadius: "50%", background: "rgba(110,231,168,0.18)", border: "1px solid rgba(110,231,168,0.35)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.02em", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#6ee7a8" }}>
                {((profile?.name || profile?.email || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("") || "?").toUpperCase()}
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
                <span>{profile?.name || profile?.email}</span>
                {profile?.position && <span style={{ fontSize: 9.5, color: "#d4af37", fontWeight: 600 }}>{profile.position}</span>}
              </span>
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
                color: isActive ? "#e8c860" : "var(--text-secondary)",
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
            {tab === "dashboard" && <Dashboard projects={projects} txs={txs} tasks={tasks} onDrillStage={(stage) => { setPendingStageFilter(stage); setTab("projects"); }} sharesByProject={sharesByProject} myShares={myShares} ownerId={profile.id} paymentsByProject={paymentsByProject} />}
            {tab === "projects" && <Projects projects={projects} setProjects={setProjects} clients={clients} client={supabase} profile={profile} ownerId={profile.id} showToast={showToast} initialStageFilter={pendingStageFilter} sharesByProject={sharesByProject} setSharesByProject={setSharesByProject} pendingProjectId={pendingProjectId} onProjectOpened={() => setPendingProjectId(null)} setPaymentsByProject={setPaymentsByProject} onMakeReport={(sel)=>{ setReportProjects(sel); setReportModal(true); }} />}
            {tab === "tasks" && <TasksView client={supabase} profile={profile} projects={projects} showToast={showToast} />}
            {tab === "clients" && <ClientsPage clients={clients} setClients={setClients} projects={projects} client={supabase} ownerId={profile.id} showToast={showToast} />}
            {tab === "myorders" && <ClientOrdersPage orders={clientProjects} />}
            {tab === "finance" && <Finance txs={txs} setTxs={setTxs} client={supabase} ownerId={profile.id} showToast={showToast} projects={projects} sharesByProject={sharesByProject} myShares={myShares} paymentsByProject={paymentsByProject} />}
            {tab === "analytics" && <Analytics projects={projects} txs={txs} sharesByProject={sharesByProject} ownerId={profile.id} paymentsByProject={paymentsByProject} />}
            {tab === "admin" && profile?.role === "admin" && <AdminPage profile={profile} client={supabase} showToast={showToast} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <Toast visible={toast.visible} text={toast.text} type={toast.type}/>

      {reportModal && <ReportViewer projects={projects} presetProjects={reportProjects} onClose={()=>{ setReportModal(false); setReportProjects(null); }}/>}
      {backupModal && <BackupPanel
        projects={projects}
        txs={txs}
        client={supabase}
        ownerId={profile.id}
        paymentsByProject={paymentsByProject}
        sharesByProject={sharesByProject}
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
