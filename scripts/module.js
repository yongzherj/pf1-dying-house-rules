/* ============================================================
 * PF1E 濒死与死门房规（半自动版）
 * ============================================================ */

const MODULE_ID = "pf1-dying-house-rules";

/* ============================================================
 * HD / 职业提取
 * ============================================================ */

function parseHitDieValue(hd) {
  if (hd === undefined || hd === null) return null;
  if (typeof hd === "number") return hd >= 2 && hd <= 20 ? hd : null;
  const m = String(hd).match(/(\d+)/);
  if (!m) return null;
  const v = parseInt(m[1]);
  return v >= 2 && v <= 20 ? v : null;
}

function normalizeClassEntry(entry) {
  if (!entry) return null;
  const name = entry.name || entry.system?.name || "?";
  const hdCandidates = [entry.system?.hd, entry.hd, entry.system?.hitDie, entry.system?.die];
  let hdValue = null;
  for (const c of hdCandidates) {
    const v = parseHitDieValue(c);
    if (v) { hdValue = v; break; }
  }
  const lvCandidates = [
    entry.system?.levels, entry.system?.level?.value, entry.system?.level,
    entry.level, entry.levels
  ];
  let level = 0;
  for (const c of lvCandidates) {
    const v = parseInt(c);
    if (!isNaN(v) && v > 0) { level = v; break; }
  }
  if (!hdValue || level <= 0) return null;
  return { hdValue, level, name };
}

function getClassEntries(actor) {
  const entries = [];
  const classes = actor.classes;
  if (classes && typeof classes === "object") {
    for (const key of Object.keys(classes)) {
      const norm = normalizeClassEntry(classes[key]);
      if (norm) entries.push(norm);
    }
  }
  if (entries.length === 0) {
    const items = actor.items?.contents || actor.items || [];
    for (const item of items) {
      if (item.type !== "class") continue;
      const norm = normalizeClassEntry(item);
      if (norm) entries.push(norm);
    }
  }
  return entries;
}

function getActorLevel(actor) {
  return actor.system?.attributes?.hd?.total
      || actor.system?.details?.level?.value
      || actor.system?.details?.level
      || 1;
}

function getHealThresholdInfo(actor) {
  const classes = getClassEntries(actor);
  const details = [];
  let total = 0;
  for (const c of classes) {
    const contrib = c.level * Math.floor(c.hdValue / 2);
    total += contrib;
    details.push(`${c.name} ${c.level}×${Math.floor(c.hdValue / 2)}=${contrib}`);
  }
  if (total > 0) return { total, details: details.join(" + ") };

  const level = getActorLevel(actor);
  const hdValue = parseHitDieValue(actor.system?.attributes?.hd?.die) || 8;
  total = level * Math.floor(hdValue / 2);
  return { total, details: `回退：等级${level} × floor(d${hdValue}/2)=${total}` };
}

function getHealThreshold(actor) {
  return getHealThresholdInfo(actor).total;
}

/* ============================================================
 * 规则 / Flags
 * ============================================================ */

function getInitialDyingCount(negativeHp) {
  if (negativeHp >= 50) return 3;
  if (negativeHp >= 25) return 2;
  if (negativeHp >= 10) return 1;
  return 0;
}

function isEnabled(actor) { return actor.getFlag(MODULE_ID, "enabled") === true; }
function isInDying(actor) { return actor.getFlag(MODULE_ID, "inDying") === true; }
function getDyingCount(actor) { return actor.getFlag(MODULE_ID, "dyingCount") ?? 0; }
function isStabilized(actor) { return actor.getFlag(MODULE_ID, "stabilized") === true; }

function getStatusInfo(actor) {
  if (!isInDying(actor)) {
    return { code: "0", label: "正常", tooltip: "未处于濒死" };
  }
  const count = getDyingCount(actor);
  const stabilized = isStabilized(actor);
  if (count >= 3) {
    return { code: "door", label: "死门", tooltip: `死门 · ${stabilized ? "已稳定" : "每轮需豁免"}` };
  }
  const sub = stabilized ? "已稳定" : "每轮+1";
  return { code: "dying", label: `濒死 ${count}`, tooltip: `濒死 计数${count} · ${sub}` };
}

/* ============================================================
 * 注入位置
 * ============================================================ */

function findSummaryTarget($html) {
  const candidates = [
    '.tab[data-tab="summary"] .attributes',
    '[data-tab="summary"] .attributes',
    '.tab.summary .attributes',
    '.tab[data-tab="summary"] .summary',
    '.tab[data-tab="summary"]',
    '[data-tab="summary"]',
    '.tab.summary',
    '.summary'
  ];
  for (const sel of candidates) {
    const $el = $html.find(sel).first();
    if ($el.length) return $el;
  }
  return null;
}

/* ============================================================
 * 面板
 * ============================================================ */

function buildPanelHtml(actor) {
  const enabled = isEnabled(actor);
  const status = getStatusInfo(actor);
  const info = getHealThresholdInfo(actor);

  return `
    <div class="pf1-dying-panel" data-actor-id="${actor.id}" data-state="${status.code}" data-enabled="${enabled ? "true" : "false"}">
      <div class="pf1-dying-row pf1-dying-row-1">
        <label class="pf1-dying-enable" title="启用濒死房规">
          <input type="checkbox" class="dying-enabled-toggle" ${enabled ? "checked" : ""} />
          <span>濒死房规</span>
        </label>
        <span class="pf1-dying-info">
          <span class="pf1-dying-threshold" title="清除1点濒死计数所需治疗量&#10;${info.details}">阈值 <b>${info.total}</b></span>
          <span class="pf1-dying-status" data-state="${status.code}" title="${status.tooltip}">${status.label}</span>
        </span>
      </div>
      <div class="pf1-dying-row pf1-dying-row-2">
        <span class="pf1-dying-buttons" role="group">
          <button type="button" class="dying-count-btn" data-count="0">0</button>
          <button type="button" class="dying-count-btn" data-count="1">1</button>
          <button type="button" class="dying-count-btn" data-count="2">2</button>
          <button type="button" class="dying-count-btn dying-count-door" data-count="3">死门</button>
        </span>
        <button type="button" class="dying-act dying-stab-btn" title="切换稳定状态">稳定</button>
        <button type="button" class="dying-act dying-heal-btn" title="输入治疗量并计算">治疗</button>
        <button type="button" class="dying-act dying-calc-btn" title="按当前 HP 计算初始计数">按HP</button>
      </div>
    </div>
  `;
}

function updatePanelUI($panel, actor) {
  const status = getStatusInfo(actor);
  const count = getDyingCount(actor);
  const stabilized = isStabilized(actor);
  const enabled = isEnabled(actor);

  $panel.attr("data-state", status.code);
  $panel.attr("data-enabled", enabled ? "true" : "false");

  $panel.find(".pf1-dying-status")
    .attr("data-state", status.code)
    .attr("title", status.tooltip)
    .text(status.label);

  $panel.find(".dying-count-btn").removeClass("active");
  $panel.find(`.dying-count-btn[data-count="${count}"]`).addClass("active");

  const $stab = $panel.find(".dying-stab-btn");
  if (stabilized) $stab.addClass("active").text("稳定✓");
  else $stab.removeClass("active").text("稳定");
  $stab.prop("disabled", !isInDying(actor));
}

/* ============================================================
 * 渲染
 * ============================================================ */

Hooks.on("renderActorSheet", (app, html, data) => {
  const actor = app.actor;
  if (!actor || actor.type !== "character") return;

  const $html = html instanceof jQuery ? html : $(html);
  if ($html.find(".pf1-dying-panel").length > 0) return;

  const $target = findSummaryTarget($html);
  if (!$target) {
    console.warn("PF1E 濒死房规 | 未找到概览注入目标。");
    return;
  }

  $target.after(buildPanelHtml(actor));
  const $panel = $html.find(".pf1-dying-panel");
  updatePanelUI($panel, actor);

  $panel.find(".dying-enabled-toggle").on("change", async (e) => {
    const on = e.target.checked;
    await actor.setFlag(MODULE_ID, "enabled", on);
    if (on && !isInDying(actor)) {
      const hp = actor.system?.attributes?.hp?.value ?? 0;
      if (hp <= 0) await enterDying(actor);
    }
    updatePanelUI($panel, actor);
  });

  $panel.find(".dying-count-btn").on("click", async (e) => {
    const val = parseInt(e.currentTarget.dataset.count) || 0;
    await actor.setFlag(MODULE_ID, "dyingCount", val);
    await actor.setFlag(MODULE_ID, "stabilized", false);
    if (val < 3) await actor.setFlag(MODULE_ID, "deathsDoorRounds", 0);
    if (!isInDying(actor)) await actor.setFlag(MODULE_ID, "inDying", true);
    updatePanelUI($panel, actor);
    // 点击"死门"按钮 → 立即触发 PF1E 原生 fort 豁免对话框
    if (val >= 3 && (game.user.isGM || actor.isOwner)) {
      await performDeathsDoorSave(actor);
    }
  });

  $panel.find(".dying-stab-btn").on("click", async () => {
    if (!isInDying(actor)) return;
    await actor.setFlag(MODULE_ID, "stabilized", !isStabilized(actor));
    updatePanelUI($panel, actor);
  });

  $panel.find(".dying-heal-btn").on("click", () => openHealDialog(actor, $panel));

  $panel.find(".dying-calc-btn").on("click", async () => {
    const hp = actor.system?.attributes?.hp?.value ?? 0;
    if (hp > 0) {
      ui.notifications.warn("角色 HP 大于 0，无需计算濒死计数。");
      return;
    }
    const initial = getInitialDyingCount(Math.abs(hp));
    await actor.setFlag(MODULE_ID, "inDying", true);
    await actor.setFlag(MODULE_ID, "dyingCount", initial);
    await actor.setFlag(MODULE_ID, "stabilized", false);
    await actor.setFlag(MODULE_ID, "deathsDoorRounds", 0);
    updatePanelUI($panel, actor);
    ui.notifications.info(`初始濒死计数：${initial}`);
  });
});

/* ============================================================
 * 进入濒死
 * ============================================================ */

async function enterDying(actor) {
  const hp = actor.system?.attributes?.hp?.value ?? 0;
  const initial = getInitialDyingCount(Math.abs(hp));

  await actor.setFlag(MODULE_ID, "inDying", true);
  await actor.setFlag(MODULE_ID, "dyingCount", initial);
  await actor.setFlag(MODULE_ID, "stabilized", false);
  await actor.setFlag(MODULE_ID, "deathsDoorRounds", 0);

  let extra = "";
  if (initial >= 3) extra = "（计数达 3，进入死门）";

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong> 进入濒死。HP: ${hp}，初始濒死计数：<strong>${initial}</strong> ${extra}</p>`
  });
}

/* ============================================================
 * 治疗
 * ============================================================ */

function openHealDialog(actor, $panel) {
  const info = getHealThresholdInfo(actor);
  const threshold = info.total;
  const currentCount = getDyingCount(actor);
  const isDoor = currentCount >= 3;

  const hint = isDoor
    ? `<span style="color:#b00;">死门状态下治疗仅能稳定，无法减少计数。</span>`
    : `<span style="color:#888;">治疗不足 ${threshold} 点时可稳定伤势（阻止每轮恶化）。</span>`;

  const content = `
    <form class="pf1-dying-heal-form">
      <div class="form-group">
        <label>治疗量：</label>
        <input type="number" name="healAmount" value="0" min="0" autofocus />
      </div>
      <p class="notes">
        当前计数：<strong>${currentCount}</strong> ｜ 清除1点需：<strong>${threshold}</strong><br>
        <span style="color:#888;font-size:11px;">${info.details}</span><br>
        ${hint}
      </p>
    </form>
  `;

  new Dialog({
    title: `应用治疗 - ${actor.name}`,
    content,
    buttons: {
      apply: {
        icon: '<i class="fas fa-check"></i>',
        label: "计算并应用",
        callback: async (html) => {
          const heal = parseInt(html.find('[name="healAmount"]').val()) || 0;
          await applyHeal(actor, heal);
          updatePanelUI($panel, actor);
        }
      },
      calcOnly: {
        icon: '<i class="fas fa-calculator"></i>',
        label: "仅计算",
        callback: (html) => {
          const heal = parseInt(html.find('[name="healAmount"]').val()) || 0;
          const msg = previewHealMsg(heal, threshold, currentCount, isDoor);
          ui.notifications.info(msg);
          ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<p>${msg}</p>`
          });
        }
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "取消" }
    },
    default: "apply"
  }).render(true);
}

function previewHealMsg(heal, threshold, currentCount, isDoor) {
  if (isDoor) return `死门：治疗 ${heal} 点仅能稳定，不减计数。`;
  const clearCount = Math.floor(heal / threshold);
  if (clearCount === 0) return `治疗 ${heal} 点（不足 ${threshold}）→ 稳定，计数保持 ${currentCount}。`;
  const newCount = Math.max(0, currentCount - clearCount);
  if (newCount === 0) {
    const overflow = heal - clearCount * threshold;
    return `治疗 ${heal} 点 → 清除 ${clearCount}，苏醒，HP 恢复至 ${overflow + 1}。`;
  }
  return `治疗 ${heal} 点 → 清除 ${clearCount}，计数 ${currentCount} → ${newCount}。`;
}

async function applyHeal(actor, heal) {
  const threshold = getHealThreshold(actor);
  const currentCount = getDyingCount(actor);
  const inDying = isInDying(actor);

  if (inDying && currentCount >= 3) {
    await actor.setFlag(MODULE_ID, "stabilized", true);
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong>：死门治疗 ${heal} 点，仅稳定，计数不变。</p>`
    });
    return;
  }

  if (!inDying) {
    const hp = actor.system?.attributes?.hp?.value ?? 0;
    await actor.update({ "system.attributes.hp.value": hp + heal });
    return;
  }

  const clearCount = Math.floor(heal / threshold);
  const overflow = heal - clearCount * threshold;
  const newCount = Math.max(0, currentCount - clearCount);

  if (clearCount === 0) {
    await actor.setFlag(MODULE_ID, "stabilized", true);
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong>：治疗 ${heal} 点（不足 ${threshold}）→ 稳定，计数保持 <strong>${currentCount}</strong>。</p>`
    });
    return;
  }

  await actor.setFlag(MODULE_ID, "dyingCount", newCount);
  await actor.setFlag(MODULE_ID, "stabilized", false);

  if (newCount === 0) {
    const awakenHp = overflow + 1;
    await actor.setFlag(MODULE_ID, "inDying", false);
    await actor.update({ "system.attributes.hp.value": awakenHp });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong>：治疗 ${heal} 点 → 清除 ${clearCount}，<strong>苏醒</strong>，HP 恢复至 ${awakenHp}。</p>`
    });
  } else {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong>：治疗 ${heal} 点 → 清除 ${clearCount}（溢出 ${overflow}），计数 ${currentCount} → <strong>${newCount}</strong>。</p>`
    });
  }
}

/* ============================================================
 * 死门强韧豁免 —— 调用 PF1E 原生对话框
 * ============================================================ */

async function performDeathsDoorSave(actor) {
  const rounds = actor.getFlag(MODULE_ID, "deathsDoorRounds") ?? 0;
  const hd = getActorLevel(actor);
  const dc = 15 + Math.floor(hd / 2) + rounds;

  // 轮数 +1（本次豁免算作一轮）
  await actor.setFlag(MODULE_ID, "deathsDoorRounds", rounds + 1);

  const flavor = `死门强韧豁免（第 ${rounds + 1} 轮 · DC ${dc}）`;

  // 优先调用 PF1E 原生 rollSavingThrow —— 不传 skipDialog，系统会弹出原生对话框
  try {
    if (typeof actor.rollSavingThrow === "function") {
      await actor.rollSavingThrow("fort", {
        dc: dc,
        flavor: flavor
      });
      return;
    }
    throw new Error("no api");
  } catch (err) {
    // 回退：手动掷骰
    console.warn("PF1E 濒死房规 | rollSavingThrow 不可用，使用回退方案。", err);
    const fortMod = actor.system?.attributes?.saves?.fort?.total ?? 0;
    const roll = new Roll("1d20 + @mod", { mod: fortMod });
    await roll.evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: flavor
    });
  }
}

/* ============================================================
 * 回合结束：恶化 + 死门自动弹 PF1E 原生豁免
 * ============================================================ */

Hooks.on("combatRound", async (combat, updateData, updateOptions) => {
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || actor.type !== "character") continue;
    if (!isEnabled(actor)) continue;
    if (!isInDying(actor)) continue;

    const count = getDyingCount(actor);
    const stabilized = isStabilized(actor);

    // 死门：自动弹出 PF1E 原生豁免对话框
    if (count >= 3) {
      if (game.user.isGM || actor.isOwner) {
        await performDeathsDoorSave(actor);
      }
      continue;
    }

    // 濒死 + 未稳定 → +1
    if (!stabilized) {
      const newCount = count + 1;
      await actor.setFlag(MODULE_ID, "dyingCount", newCount);
      const enteredDoor = newCount >= 3;
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><strong>${actor.name}</strong> 濒死恶化：${count} → <strong>${newCount}</strong>${enteredDoor ? "（<span style='color:#b00;'>进入死门！</span>）" : ""}</p>`
      });
    }
  }
});

/* ============================================================
 * HP 变化
 * ============================================================ */

Hooks.on("preUpdateActor", (actor, change, options, userId) => {
  const newHp = foundry.utils.getProperty(change, "system.attributes.hp.value");
  if (newHp === undefined) return;
  const oldHp = actor.system?.attributes?.hp?.value;
  if (oldHp === undefined) return;
  actor._pf1DyingOldHp = oldHp;
  actor._pf1DyingNewHp = newHp;
});

Hooks.on("updateActor", async (actor, change, options, userId) => {
  const oldHp = actor._pf1DyingOldHp;
  const newHp = actor._pf1DyingNewHp;
  delete actor._pf1DyingOldHp;
  delete actor._pf1DyingNewHp;

  if (oldHp === undefined || newHp === undefined) return;
  if (!isEnabled(actor)) return;

  if (newHp <= 0 && oldHp > 0 && !isInDying(actor)) {
    await enterDying(actor);
  } else if (newHp > 0 && oldHp <= 0 && isInDying(actor)) {
    await actor.setFlag(MODULE_ID, "inDying", false);
    await actor.setFlag(MODULE_ID, "dyingCount", 0);
    await actor.setFlag(MODULE_ID, "stabilized", false);
    await actor.setFlag(MODULE_ID, "deathsDoorRounds", 0);
  }
});

/* ============================================================
 * 初始化
 * ============================================================ */

Hooks.once("init", () => {
  console.log("PF1E 濒死与死门房规 | 初始化");
});

Hooks.once("ready", () => {
  globalThis.pf1DyingDebug = (actor) => {
    actor = actor || canvas?.tokens?.controlled?.[0]?.actor;
    if (!actor) return console.warn("无目标角色");
    console.log("=== PF1E 濒死房规调试 ===");
    console.log("角色:", actor.name);
    console.log("启用:", isEnabled(actor), "inDying:", isInDying(actor));
    console.log("count:", getDyingCount(actor), "stabilized:", isStabilized(actor));
    console.log("职业条目:", getClassEntries(actor));
    const info = getHealThresholdInfo(actor);
    console.log("治疗阈值:", info.total, "|", info.details);
  };
  console.log("PF1E 濒死与死门房规 | 就绪。pf1DyingDebug()");
});
