function fail(error, fallback = "Ошибка Supabase") {
  if (error) throw new Error(error.message || String(error));
  throw new Error(fallback);
}

function requireData(response, message) {
  if (response?.error) fail(response.error);
  if (response?.data == null) fail(null, message);
  return response.data;
}

function nullable(value) {
  return value === undefined ? undefined : (value === "" ? null : value);
}

function projectToDb(input) {
  const out = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.client !== undefined) out.client = nullable(input.client);
  if (input.executors !== undefined) {
    out.executors = input.executors.map(item => ({ name: item.name, userId: item.userId || null }));
    out.executor = input.executors.map(item => item.name).filter(Boolean).join(", ") || null;
  }
  if (input.type !== undefined) out.type = input.type;
  if (input.stage !== undefined) out.stage = input.stage;
  if (input.startDate !== undefined) out.start_date = nullable(input.startDate);
  if (input.deadline !== undefined) out.deadline = nullable(input.deadline);
  if (input.contractSum !== undefined) out.contract_sum = input.contractSum;
  if (input.notes !== undefined) out.notes = nullable(input.notes);
  if (input.visibility !== undefined) out.visibility = input.visibility;
  if (input.links !== undefined) out.links = input.links.map(item => ({ title: item.title || "Ссылка", url: item.url }));
  if (input.clientPhone !== undefined) out.client_phone = nullable(input.clientPhone);
  if (input.clientEmail !== undefined) out.client_email = nullable(input.clientEmail);
  if (input.clientTelegram !== undefined) out.client_telegram = nullable(input.clientTelegram?.replace(/^@/, ""));
  if (input.clientId !== undefined) out.client_id = input.clientId || null;
  return out;
}

function taskToDb(input) {
  const out = {};
  if (input.projectId !== undefined) out.project_id = input.projectId || null;
  if (input.assignedTo !== undefined) out.assigned_to = input.assignedTo || null;
  if (input.title !== undefined) out.title = input.title;
  if (input.description !== undefined) out.description = nullable(input.description);
  if (input.status !== undefined) out.status = input.status;
  if (input.priority !== undefined) out.priority = input.priority;
  if (input.dueDate !== undefined) out.due_date = nullable(input.dueDate);
  if (input.sortOrder !== undefined) out.sort_order = input.sortOrder;
  return out;
}

function clientToDb(input) {
  const out = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.phone !== undefined) out.phone = nullable(input.phone);
  if (input.email !== undefined) out.email = nullable(input.email);
  if (input.telegram !== undefined) out.telegram = nullable(input.telegram?.replace(/^@/, ""));
  if (input.clientType !== undefined) out.client_type = input.clientType;
  if (input.category !== undefined) out.category = input.category;
  if (input.legalName !== undefined) out.legal_name = nullable(input.legalName);
  if (input.inn !== undefined) out.inn = nullable(input.inn);
  if (input.address !== undefined) out.address = nullable(input.address);
  if (input.city !== undefined) out.city = nullable(input.city);
  if (input.notes !== undefined) out.notes = nullable(input.notes);
  return out;
}

function transactionToDb(input) {
  const out = {};
  if (input.date !== undefined) out.date = input.date;
  if (input.type !== undefined) out.type = input.type;
  if (input.category !== undefined) out.category = input.category;
  if (input.amount !== undefined) out.amount = input.amount;
  if (input.description !== undefined) out.description = nullable(input.description);
  return out;
}

async function tableSingle(client, table, id, columns = "*") {
  const response = await client.from(table).select(columns).eq("id", id).maybeSingle();
  if (response.error) fail(response.error);
  return response.data || null;
}

function slice(data, limit) {
  return Array.isArray(data) ? data.slice(0, limit) : data;
}

export function createSupabaseGateway(client) {
  async function accessMode(identity) {
    if (!identity?.id) throw new Error("Не удалось определить пользователя для ролевой проекции");
    const profileResponse = await client.from("profiles").select("role").eq("id", identity.id).maybeSingle();
    if (profileResponse.error) fail(profileResponse.error);
    const rolesResponse = await client.rpc("get_my_roles");
    if (rolesResponse.error) fail(rolesResponse.error);
    const roles = (rolesResponse.data || []).map(item => item.role);
    if (profileResponse.data?.role === "admin" || roles.includes("employee")) return "team";
    if (roles.includes("client")) return "client";
    return "visitor";
  }

  async function getContext(identity) {
    const profileResponse = await client.from("profiles").select("id, email, name, role, approved, position, username").eq("id", identity.id).single();
    const profile = requireData(profileResponse, "Профиль текущего пользователя не найден");
    const rolesResponse = await client.rpc("get_my_roles");
    if (rolesResponse.error) fail(rolesResponse.error);
    return {
      user: { id: identity.id, email: identity.email || profile.email || "" },
      profile,
      roles: (rolesResponse.data || []).map(item => item.role),
    };
  }

  async function query(input, identity) {
    const { entity, id, projectId, taskId, status, search, cursor, limit } = input;
    const mode = await accessMode(identity);
    let response;

    if (entity === "projects") {
      if (mode === "client") {
        response = await client.rpc("get_my_client_projects");
      } else {
        let q = client.from("projects").select("*");
        if (id) q = q.eq("id", id);
        if (search) q = q.ilike("name", `%${search}%`);
        if (cursor) q = q.lt("created_at", cursor);
        response = await q.order("created_at", { ascending: false }).limit(limit);
      }
    } else if (entity === "tasks") {
      response = await client.rpc("get_tasks", { p_project_id: projectId || null, p_status: status || null, p_assigned_to: null });
    } else if (entity === "tz_versions") {
      if (!taskId) throw new Error("Для tz_versions обязателен taskId");
      response = await client.rpc("get_task_versions", { p_task_id: taskId });
    } else if (entity === "project_comments") {
      if (mode === "client") throw new Error("Сущность project_comments недоступна в режиме заказчика; используйте task_comments или client_messages");
      if (!projectId) throw new Error("Для project_comments обязателен projectId");
      response = await client.rpc("get_project_comments", { p_project_id: projectId });
    } else if (entity === "task_comments") {
      if (!taskId) throw new Error("Для task_comments обязателен taskId");
      response = await client.rpc("get_task_comments", { p_task_id: taskId });
    } else if (entity === "client_messages") {
      if (!projectId) throw new Error("Для client_messages обязателен projectId");
      response = await client.rpc("get_client_messages", { p_project_id: projectId });
    } else if (entity === "clients") {
      if (search) response = await client.rpc("search_clients", { p_query: search });
      else {
        let q = client.from("clients").select("*");
        if (id) q = q.eq("id", id);
        response = await q.order("name", { ascending: true }).limit(limit);
      }
    } else if (entity === "transactions") {
      let q = client.from("transactions").select("*");
      if (id) q = q.eq("id", id);
      if (cursor) q = q.lt("date", cursor);
      response = await q.order("date", { ascending: false }).limit(limit);
    } else if (entity === "project_files") {
      if (!projectId) throw new Error("Для project_files обязателен projectId");
      response = await client.rpc(mode === "client" ? "get_client_project_files" : "get_project_files", { p_project_id: projectId });
    } else if (entity === "project_members") {
      if (mode === "client") throw new Error("Сущность project_members недоступна в режиме заказчика");
      if (!projectId) throw new Error("Для project_members обязателен projectId");
      response = await client.rpc("get_project_members", { p_project_id: projectId });
    } else if (entity === "project_payments") {
      if (!projectId) throw new Error("Для project_payments обязателен projectId");
      if (mode === "client") response = await client.rpc("get_my_project_payments");
      else response = await client.from("project_payments").select("id, project_id, amount, paid_on, note, created_at").eq("project_id", projectId).order("paid_on", { ascending: false }).limit(limit);
    } else if (entity === "project_shares") {
      if (mode === "client") throw new Error("Сущность project_shares недоступна в режиме заказчика");
      if (!projectId) throw new Error("Для project_shares обязателен projectId");
      response = await client.from("project_shares").select("*").eq("project_id", projectId).limit(limit);
    } else if (entity === "project_requests") {
      let q = client.from("project_requests").select("*");
      if (id) q = q.eq("id", id);
      if (status) q = q.eq("status", status);
      response = await q.order("created_at", { ascending: false }).limit(limit);
    } else if (entity === "activity") {
      if (mode === "client") throw new Error("Сущность activity недоступна в режиме заказчика");
      if (projectId) response = await client.rpc("get_project_activity", { p_project_id: projectId, p_limit: limit });
      else response = await client.from("activity_log").select("*").order("created_at", { ascending: false }).limit(limit);
    } else if (entity === "users") {
      response = await client.rpc("admin_list_users");
    } else {
      throw new Error(`Неизвестная сущность: ${entity}`);
    }

    if (response?.error) fail(response.error);
    let data = response?.data || [];
    if (id && Array.isArray(data)) data = data.filter(item => item.id === id);
    if (search && mode === "client" && entity === "projects" && Array.isArray(data)) {
      const term = search.toLowerCase();
      data = data.filter(item => `${item.name || ""} ${item.executor || ""}`.toLowerCase().includes(term));
    }
    if (projectId && mode === "client" && entity === "project_payments" && Array.isArray(data)) {
      data = data.filter(item => item.project_id === projectId);
    }
    if (taskId && entity === "tasks" && Array.isArray(data)) data = data.filter(item => item.id === taskId);
    if (search && entity === "tasks" && Array.isArray(data)) {
      const term = search.toLowerCase();
      data = data.filter(item => `${item.title || ""} ${item.description || ""}`.toLowerCase().includes(term));
    }
    return slice(data, limit);
  }

  async function snapshot(action, payload) {
    if (action.endsWith(".create") || action.endsWith(".add") || action === "tz.propose" || action === "client_message.send") return null;
    if (action === "project.payments.set" || action === "project.shares.set") {
      const project = await tableSingle(client, "projects", payload.projectId, "id, owner_id, updated_at");
      if (!project) return null;
      const table = action === "project.payments.set" ? "project_payments" : "project_shares";
      const response = await client.from(table).select("*").eq("project_id", payload.projectId).order("created_at", { ascending: true }).limit(500);
      if (response.error) fail(response.error);
      return { project, rows: response.data || [] };
    }
    if (action.startsWith("project.")) return tableSingle(client, "projects", payload.id);
    if (action.startsWith("task.") && !action.startsWith("task_comment.")) return tableSingle(client, "project_tasks", payload.id);
    if (action === "tz.approve" || action === "tz.reject") return tableSingle(client, "task_tz_versions", payload.versionId);
    if (action.startsWith("project_comment.")) return tableSingle(client, "project_comments", payload.commentId);
    if (action === "task_comment.resolve") return tableSingle(client, "task_comments", payload.commentId);
    if (action.startsWith("client.") && action !== "client_message.send") return tableSingle(client, "clients", payload.id);
    if (action.startsWith("transaction.")) return tableSingle(client, "transactions", payload.id);
    if (action.startsWith("member.")) {
      const response = await client.from("project_members").select("*").eq("project_id", payload.projectId).eq("user_id", payload.userId).maybeSingle();
      if (response.error) fail(response.error);
      return response.data || null;
    }
    if (action.startsWith("request.")) return tableSingle(client, "project_requests", payload.requestId);
    if (action.startsWith("file.")) return tableSingle(client, "project_files", payload.fileId);
    if (action.startsWith("admin.")) {
      const response = await client.rpc("admin_list_users");
      if (response.error) fail(response.error);
      return (response.data || []).find(item => (item.id || item.user_id) === payload.userId) || null;
    }
    return null;
  }

  async function directMutation(query, message) {
    const response = await query;
    return requireData(response, message);
  }

  async function execute(action, payload, identity) {
    if (action === "project.create") {
      return directMutation(client.from("projects").insert({ ...projectToDb(payload), owner_id: identity.id }).select("*").single(), "Проект не создан");
    }
    if (action === "project.update") {
      return directMutation(client.from("projects").update(projectToDb(payload.patch)).eq("id", payload.id).select("*").maybeSingle(), "Проект не изменён: нет доступа или запись отсутствует");
    }
    if (action === "project.delete") {
      return directMutation(client.from("projects").delete().eq("id", payload.id).select("id").maybeSingle(), "Проект не удалён: нет доступа или запись отсутствует");
    }
    if (["project.take", "project.release", "project.revoke"].includes(action)) {
      const rpc = { "project.take": "take_project", "project.release": "release_project", "project.revoke": "revoke_project" }[action];
      const response = await client.rpc(rpc, { p_project_id: payload.id });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "project.payments.set") {
      const rows = payload.rows.map(row => ({ amount: row.amount, paid_on: row.paidOn, note: row.note || null }));
      const response = await client.rpc("set_project_payments", { p_project_id: payload.projectId, p_rows: rows });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true, projectId: payload.projectId, count: rows.length };
    }
    if (action === "project.shares.set") {
      const rows = payload.rows.map(row => ({
        participant_user_id: row.participantUserId || null,
        participant_client_id: row.participantClientId || null,
        participant_name: row.participantName || null,
        participant_label: row.participantLabel || null,
        share_kind: row.shareKind,
        share_value: row.shareValue,
      }));
      const response = await client.rpc("set_project_shares", { p_project_id: payload.projectId, p_rows: rows });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true, projectId: payload.projectId, count: rows.length };
    }
    if (action === "task.create") {
      return directMutation(client.from("project_tasks").insert({ ...taskToDb(payload), author_id: identity.id }).select("*").single(), "Задача не создана");
    }
    if (action === "task.update") {
      return directMutation(client.from("project_tasks").update(taskToDb(payload.patch)).eq("id", payload.id).select("*").maybeSingle(), "Задача не изменена: нет доступа или запись отсутствует");
    }
    if (action === "task.delete") {
      // Повторяет семантику сайта: очистка байтов фото best-effort, удаление строки — authoritative.
      await client.functions.invoke("nextcloud", { body: { action: "task-photos-purge", taskId: payload.id } });
      return directMutation(client.from("project_tasks").delete().eq("id", payload.id).select("id").maybeSingle(), "Задача не удалена: нет доступа или запись отсутствует");
    }
    if (action === "task.set_status") {
      const mode = await accessMode(identity);
      const response = await client.rpc(mode === "client" ? "client_set_task_status" : "set_task_status", { p_task_id: payload.id, p_status: payload.status });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "tz.propose") {
      const response = await client.rpc("propose_tz_version", { p_task_id: payload.taskId, p_content: payload.content });
      return requireData(response, "Версия ТЗ не создана");
    }
    if (action === "tz.approve" || action === "tz.reject") {
      const response = await client.rpc(action === "tz.approve" ? "approve_tz_version" : "reject_tz_version", { p_version_id: payload.versionId });
      return requireData(response, "Статус версии ТЗ не изменён");
    }
    if (action === "project_comment.add") {
      return directMutation(client.from("project_comments").insert({ project_id: payload.projectId, author_id: identity.id, content: payload.content }).select("*").single(), "Комментарий не добавлен");
    }
    if (action === "project_comment.resolve") {
      const response = await client.rpc("resolve_project_comment", { p_comment_id: payload.commentId, p_resolved: payload.resolved });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "project_comment.delete") {
      const response = await client.rpc("delete_project_comment", { p_comment_id: payload.commentId });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "task_comment.add") {
      return directMutation(client.from("task_comments").insert({ task_id: payload.taskId, author_id: identity.id, body: payload.body, is_question: payload.isQuestion }).select("*").single(), "Комментарий задачи не добавлен");
    }
    if (action === "task_comment.resolve") {
      const response = await client.rpc("resolve_question", { p_comment_id: payload.commentId, p_resolved: payload.resolved });
      return requireData(response, "Вопрос задачи не изменён");
    }
    if (action === "client.create") {
      return directMutation(client.from("clients").insert({ ...clientToDb(payload), owner_id: identity.id }).select("*").single(), "Клиент не создан");
    }
    if (action === "client.update") {
      return directMutation(client.from("clients").update(clientToDb(payload.patch)).eq("id", payload.id).select("*").maybeSingle(), "Клиент не изменён: нет доступа или запись отсутствует");
    }
    if (action === "client.delete") {
      return directMutation(client.from("clients").delete().eq("id", payload.id).select("id").maybeSingle(), "Клиент не удалён: нет доступа или запись отсутствует");
    }
    if (action === "transaction.create") {
      return directMutation(client.from("transactions").insert({ ...transactionToDb(payload), owner_id: identity.id }).select("*").single(), "Операция не создана");
    }
    if (action === "transaction.update") {
      return directMutation(client.from("transactions").update(transactionToDb(payload.patch)).eq("id", payload.id).select("*").maybeSingle(), "Операция не изменена: нет доступа или запись отсутствует");
    }
    if (action === "transaction.delete") {
      return directMutation(client.from("transactions").delete().eq("id", payload.id).select("id").maybeSingle(), "Операция не удалена: нет доступа или запись отсутствует");
    }
    if (action === "member.add") {
      return directMutation(client.from("project_members").insert({ project_id: payload.projectId, user_id: payload.userId, role: payload.role }).select("*").single(), "Участник не добавлен");
    }
    if (action === "member.update_role") {
      return directMutation(client.from("project_members").update({ role: payload.role }).eq("project_id", payload.projectId).eq("user_id", payload.userId).select("*").maybeSingle(), "Роль участника не изменена");
    }
    if (action === "member.remove") {
      return directMutation(client.from("project_members").delete().eq("project_id", payload.projectId).eq("user_id", payload.userId).select("project_id, user_id").maybeSingle(), "Участник не удалён");
    }
    if (action === "request.create") {
      const response = await client.rpc("create_project_request", { p_name: payload.name, p_description: payload.description ?? null, p_deadline: payload.deadline ?? null, p_mode: payload.mode, p_assignment_mode: payload.assignmentMode, p_desired_executor_id: payload.desiredExecutorId ?? null, p_client_id: null });
      return requireData(response, "Заявка не создана");
    }
    if (action === "request.accept" || action === "request.reject") {
      const response = await client.rpc(action === "request.accept" ? "accept_project_request" : "reject_project_request", action === "request.accept" ? { p_request_id: payload.requestId } : { p_request_id: payload.requestId, p_reason: payload.reason ?? null });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "client_message.send") {
      const response = await client.rpc("post_client_message", { p_project_id: payload.projectId, p_body: payload.body });
      return requireData(response, "Сообщение не отправлено");
    }
    if (action === "file.set_client_visible") {
      const response = await client.rpc("set_file_client_visible", { p_file_id: payload.fileId, p_visible: payload.visible });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "file.delete") {
      const response = await client.functions.invoke("nextcloud", { body: { action: "delete", id: payload.fileId } });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "admin.user.update") {
      const response = await client.rpc("admin_update_user", { p_user_id: payload.userId, p_approved: payload.approved, p_role: payload.role, p_name: payload.name });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "admin.roles.set") {
      const response = await client.rpc("set_user_roles", { p_user_id: payload.userId, p_roles: payload.roles });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    if (action === "admin.user.delete") {
      const response = await client.rpc("admin_delete_user", { p_user_id: payload.userId });
      if (response.error) fail(response.error);
      return response.data ?? { ok: true };
    }
    throw new Error(`Действие не реализовано: ${action}`);
  }

  async function audit(action, payload, result) {
    try {
      await client.rpc("log_activity", {
        p_action: `mcp_${action.replaceAll(".", "_")}`,
        p_target_id: result?.id || payload?.id || payload?.taskId || payload?.projectId || payload?.userId || null,
        p_target_email: null,
        p_details: { source: "mcp", action },
      });
    } catch {
      // Existing domain mutations stay authoritative; audit marking is best-effort.
    }
  }

  return { getContext, query, snapshot, execute, audit };
}
