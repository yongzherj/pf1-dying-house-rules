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
 * 房规规则
 * ============================================================ */

function getInitialDyingCount(negativeHp) {
  if (negativeHp >= 50) return 3;
  if (negativeHp >= 25) return 2;
  if (negativeHp >= 10) return 1;
  return 0;
}

function getStateCode(count) {
  if (count >= 3) return "door";
  if (count > 0) return "dying";
  return "0";
}

function getStatusInfo(count, stabilized) {
  if (count >= 3) {
    return { code: "door", label: "死门", sub: stabilized ? "已稳定" : "待豁免" };
  }
  if (count > 0) {
    return { code: "dying", label: `濒死 ${count}`, sub: stabilized ? "已稳定" : "每轮+1" };
  }
  return { code: "0", label: "正常", sub: "" };
}

function isEnabled(actor) {
  return actor.getFlag(MODULE_ID, "enabled") === true;
}

function getDyingCount(actor) {
  return actor.getFlag(MODULE_ID, "dyingCount") ?? 0;
}

function isStabilized(actor) {
  return actor.getFlag(MODULE_ID, "stabilized") === true;
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
 * 面板构建与刷新
 * ============================================================ */

function buildPanelHtml(actor) {
  const enabled = isEnabled(actor);
  const count = getDyingCount(actor);
  const stabilized = isStabilized(actor);
  const info = getHealThresholdInfo(actor);
  const status = getStatusInfo(count, stabilized);

  return `
    <div class="pf1-dying-panel" data-actor-id="${actor.id}" data-state="${status.code}">
      <div class="pf1-dying-row-1">
        <label class="pf1-dying-enable">
          <input type="checkbox" class="dying-enabled-toggle" ${enabled ? "checked" : ""} />
          <span>濒死房规</span>
        </label>
        <span class="pf1-dying-status" data-state="${status.code}">
          <span class="dying-status-label">${status.label}</span>
          <span class="dying-status-sub">${status.sub}</span>
        </span>
      </div>
      <div class="pf1-dying-row-2">
        <div class="pf1-dying-buttons" role="group" aria-label="濒死计数">
          <button type="button" class="dying-count-btn" data-count="0">0</button>
          <button type="button" class="dying-count-btn" data-count="1">1</button>
          <button type="button" class="dying-count-btn" data-count="2">2</button>
          <button type="button" class="dying-count-btn dying-count-door" data-count="3">死门</button>
        </div>
        <button type="button" class="dying-act dying-stab-btn">稳定</button>
        <button type="button" class="dying-act dying-heal-btn">治疗</button>
        <button type="button" class="dying-act dying-calc-btn" title="按当前 HP 计算初始计数">按HP</button>
        <button type="button" class="dying-act dying-save-btn" title="死门强韧豁免">豁免</button>
        <span class="pf1-dying-threshold" title="清除 1 点濒死计数所需治疗量&#10;${info.details}">
          阈 <b>${info.total}</b>
        </span>
      </div>
    </div>
  `;
}

function updatePanelUI($panel, actor) {
  const count = getDyingCount(actor);
  const stabilized = isStabilized(actor);
  const status = getStatusInfo(count, stabilized);

  $panel.attr("data-state", status.code);
  $panel.find(".pf1-dying-status")
    .attr("data-state", status.code)
    .find(".dying-status-label").text(status.label).end()
    .find(".dying-status-sub").text(status.sub);

  $panel.find(".dying-count-btn").removeClass("active");
  $panel.find(`.dying-count-btn[data-count="${count}"]`).addClass("active");

  // 稳定按钮
  const $stab = $panel.find(".dying-stab-btn");
  if (stabilized) {
    $stab.text("已稳定").addClass("active");
  } else {
    $stab.text("稳定").removeClass("active");
  }
  $stab.prop("disabled", count === 0);

  // 豁免按钮：仅在死门时显示
  $panel.find(".dying-save-btn").toggle(count >= 3);

  // 启用状态下的 controls 可见性
  $panel.find(".pf1-dying-row-2").toggle(isEnabled(actor));
}

/* ============================================================
 * 角色卡注入
 * ============================================================ */

Hooks.on("renderActorSheet", (app, html, data) => {
  const actor = app.actor;
  if (!actor || actor.type !== "character") return;

  const $html = html instanceof jQuery ? html : $(html);
  if ($html.find(".pf1-dying-panel").length > 0) return;

  const $target = findSummaryTarget($html);
  if (!$target) {
    console.warn("PF1E 濒死房规 | 未找到概览注入目标，跳过 UI 注入。");
    return;
  }

  $target.after(buildPanelHtml(actor));
  const $panel = $html.find(".pf1-dying-panel");
  updatePanelUI($panel, actor);

  /* 启用切换 */
  $panel.find(".dying-enabled-toggle").on("change", async (e) => {
    await actor.setFlag(MODULE_ID, "enabled", e.target.checked);
    updatePanelUI($panel, actor);
  });

  /* 计数按钮 */
  $panel.find(".dying-count-btn").on("click", async (e) => {
    const val = parseInt(e.currentTarget.dataset.count) || 0;
    await actor.setFlag(MODULE_ID, "dyingCount", val);
    // 计数一旦变化，清除稳定标记
    await actor.setFlag(MODULE_ID, "stabilized", false);
    // 若离开死门，重置豁免轮数
    if (val < 3) await actor.setFlag(MODULE_ID, "deathsDoorRounds", 0);
    updatePanelUI($panel, actor);
  });

  /* 稳定切换 */
  $panel.find(".dying-stab-btn").on("click", async () => {
    const cur = isStabilized(actor);
    await actor.setFlag(MODULE_ID, "stabilized", !cur);
    updatePanelUI($panel, actor);
  });

  /* 治疗 */
  $panel.find(".dying-heal-btn").on("click", () => {
    openHealDialog(actor, $panel);
  });

  /* 按 HP 计算 */
  $panel.find(".dying-calc-btn").on("click", async () => {
    const hp = actor.system?.attributes?.hp?.value ?? 0;
    if (hp > 0) {
      ui.notifications.warn("角色 HP 大于 0，无需计算濒死计数。");
      return;
    }
    const initial = getInitialDyingCount(Math.abs(hp));
    await actor.setFlag(MODULE_ID, "dyingCount", initial);
    await actor.setFlag(MODULE_ID, "stabilized", false);
    await actor.setFlag(MODULE_ID, "deathsDoorRounds", 0);
    updatePanelUI($panel, actor);
    ui.notifications.info(`初始濒死计数：${initial}`);
  });

  /* 死门豁免 */
  $panel.find(".dying-save-btn").on("click", async () => {
    await performDeathsDoorSave(actor);
    updatePanelUI($panel, actor);
  });
});

/* ============================================================
 * 治疗
 * ============================================================ */

function openHealDialog(actor, $panel) {
  const info = getHealThresholdInfo(actor);
  const threshold = info.total;
  const currentCount = getDyingCount(actor);
  const isDoor = currentCount >= 3;

  const hint = isDoor
    ? `<span style="color:#b00;">死门状态下治疗仅能稳定伤势，无法减少计数。</span>`
    : `<span style="color:#888;">治疗不足 ${threshold} 点时可稳定伤势（阻止每轮恶化）。</span>`;

  const content = `
    <form class="pf1-dying-heal-form">
      <div class="form-group">
        <label>治疗量：</label>
        <input type="number" name="healAmount" value="0" min="0" autofocus />
      </div>
      <p class="notes">
        当前濒死计数：<strong>${currentCount}</strong><br>
        清除 1 点所需治疗：<strong>${threshold}</strong> 点<br>
        <span style="color:#888;font-size:11px;">计算：${info.details}</span><br>
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
          const msg = previewHealMsg(actor, heal, threshold, currentCount);
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

function previewHealMsg(actor, heal, threshold, currentCount) {
  if (currentCount >= 3) {
    return `死门状态下治疗 ${heal} 点，仅能稳定伤势，无法减少濒死计数。`;
  }
  const clearCount = Math.floor(heal / threshold);
  if (clearCount === 0) {
    return `治疗 ${heal} 点（不足 ${threshold}）→ 稳定伤势，濒死计数保持 ${currentCount}。`;
  }
  const newCount = Math.max(0, currentCount - clearCount);
  if (newCount === 0) {
    const overflow = heal - clearCount * threshold;
    return `治疗 ${heal} 点 → 清除 ${clearCount} 点计数，苏醒，HP 恢复至 ${overflow + 1}。`;
  }
  return `治疗 ${heal} 点 → 清除 ${clearCount} 点计数，濒死 ${currentCount} → ${newCount}。`;
}

async function applyHeal(actor, heal) {
  const threshold = getHealThreshold(actor);
  const currentCount = getDyingCount(actor);

  // 死门：只稳定，不减计数（规则 4）
  if (currentCount >= 3) {
    await actor.setFlag(MODULE_ID, "stabilized", true);
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong>：死门状态下治疗 ${heal} 点，仅能稳定伤势，无法减少濒死计数。</p>`
    });
    return;
  }

  const clearCount = Math.floor(heal / threshold);
  const overflow = heal - clearCount * threshold;
  const newCount = Math.max(0, currentCount - clearCount);

  // 治疗不足 1 点 → 稳定（规则 5.2）
  if (clearCount === 0) {
    await actor.setFlag(MODULE_ID, "stabilized", true);
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong>：治疗 ${heal} 点（不足 ${threshold}）→ 伤势稳定，濒死计数保持 <strong>${currentCount}</strong>。</p>`
    });
    return;
  }

  // 清除计数
  await actor.setFlag(MODULE_ID, "dyingCount", newCount);
  await actor.setFlag(MODULE_ID, "stabilized", false);

  if (newCount === 0) {
    const awakenHp = overflow + 1;
    await actor.update({ "system.attributes.hp.value": awakenHp });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong>：治疗 ${heal} 点 → 清除 ${clearCount} 点计数，<strong>苏醒</strong>，HP 恢复至 ${awakenHp}。</p>`
    });
  } else {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong>：治疗 ${heal} 点 → 清除 ${clearCount} 点计数（溢出 ${overflow}），濒死计数 ${currentCount} → <strong>${newCount}</strong>。</p>`
    });
  }
}

/* ============================================================
 * 死门强韧豁免（手动点击触发）
 * ============================================================ */

async function performDeathsDoorSave(actor) {
  const rounds = actor.getFlag(MODULE_ID, "deathsDoorRounds") ?? 0;
  const hd = getActorLevel(actor);
  const dc = 15 + Math.floor(hd / 2) + rounds;
  const fortMod = actor.system?.attributes?.saves?.fort?.total ?? 0;

  const roll = new Roll("1d20 + @mod", { mod: fortMod });
  await roll.evaluate();
  const d20 = roll.dice[0].total;
  const total = roll.total;

  await actor.setFlag(MODULE_ID, "deathsDoorRounds", rounds + 1);

  const success = total >= dc;

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="pf1-dying-save">
        <p><strong>${actor.name}</strong> 死门强韧豁免（第 ${rounds + 1} 轮，DC ${dc}）</p>
        <p>1d20(${d20}) + ${fortMod} = <strong>${total}</strong></p>
        <p style="color:${success ? '#2a7' : '#b00'};font-weight:bold;">
          ${success ? "✓ 成功，继续坚持" : "✗ 失败，角色死亡"}
        </p>
      </div>
    `
  });

  if (!success) {
    await actor.toggleStatusEffect("dead", { active: true });
  }
}

/* ============================================================
 * 回合结束：恶化与死门提醒
 * ============================================================ */

Hooks.on("combatRound", async (combat, updateData, updateOptions) => {
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || actor.type !== "character") continue;
    if (!isEnabled(actor)) continue;

    const count = getDyingCount(actor);
    if (count <= 0) continue;

    const stabilized = isStabilized(actor);

    // 死门：只提醒，不自动掷（半自动）
    if (count >= 3) {
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><strong>${actor.name}</strong> 处于死门，请点击角色卡上的「豁免」进行强韧豁免。</p>`
      });
      continue;
    }

    // 濒死：未稳定则每轮 +1
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
 * HP 变化自动检测
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

  // 进入濒死：HP 从 >0 变为 ≤0
  if (newHp <= 0 && oldHp > 0) {
    const initial = getInitialDyingCount(Math.abs(newHp));
    await actor.setFlag(MODULE_ID, "dyingCount", initial);
    await actor.setFlag(MODULE_ID, "stabilized", false);
    await actor.setFlag(MODULE_ID, "deathsDoorRounds", 0);

    let extra = "";
    if (initial >= 3) extra = "（计数达 3，进入死门）";
    else if (initial === 0) extra = "（计数 0）";

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong> 进入濒死。HP: ${newHp}，初始濒死计数：<strong>${initial}</strong> ${extra}</p>`
    });
  }
  // 从濒死恢复：HP 从 ≤0 变为 >0
  else if (newHp > 0 && oldHp <= 0) {
    await actor.setFlag(MODULE_ID, "dyingCount", 0);
    await actor.setFlag(MODULE_ID, "stabilized", false);
    await actor.setFlag(MODULE_ID, "deathsDoorRounds", 0);
  }
});

/* ============================================================
 * 初始化与调试
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
    console.log("总等级:", getActorLevel(actor));
    console.log("职业条目:", getClassEntries(actor));
    const info = getHealThresholdInfo(actor);
    console.log("治疗阈值:", info.total, "| 计算:", info.details);
    console.log("当前计数:", getDyingCount(actor), "| 稳定:", isStabilized(actor));
  };
  console.log("PF1E 濒死与死门房规 | 就绪。调试命令：pf1DyingDebug()");
});
