/* ============================================================
 * PF1E 濒死与死门房规（半自动版）
 * 默认关闭，勾选启用后对单张角色卡生效
 * ============================================================ */

const MODULE_ID = "pf1-dying-house-rules";

/* ---------- HD 提取（多路径回退） ---------- */

function parseHitDieValue(hd) {
  if (!hd) return null;
  if (typeof hd === "number") return hd >= 2 && hd <= 20 ? hd : null;
  const m = String(hd).match(/(\d+)/);
  if (!m) return null;
  const v = parseInt(m[1]);
  return v >= 2 && v <= 20 ? v : null;
}

function getHitDieValue(actor) {
  // 1. actor.classes 派生数据
  const classes = actor.classes;
  if (classes && typeof classes === "object") {
    let best = 0;
    for (const cls of Object.values(classes)) {
      const v = parseHitDieValue(cls?.hd);
      if (v && v > best) best = v;
    }
    if (best > 0) return best;
  }

  // 2. class items
  const classItems = (actor.items?.contents || actor.items || []);
  let best = 0;
  for (const item of classItems) {
    if (item.type !== "class") continue;
    const candidates = [
      item.system?.hd,
      item.system?.hd?.value,
      item.system?.hitDie,
      item.system?.die
    ];
    for (const c of candidates) {
      const v = parseHitDieValue(c);
      if (v && v > best) best = v;
    }
  }
  if (best > 0) return best;

  // 3. actor.system.attributes.hd.*
  const sysCandidates = [
    actor.system?.attributes?.hd?.die,
    actor.system?.attributes?.hd?.dieSize,
    actor.system?.attributes?.hd?.hitDie,
    actor.system?.attributes?.hd
  ];
  for (const c of sysCandidates) {
    const v = parseHitDieValue(c);
    if (v) return v;
  }

  return 8; // 默认 d8
}

function getActorLevel(actor) {
  return actor.system?.attributes?.hd?.total
      || actor.system?.details?.level?.value
      || actor.system?.details?.level
      || 1;
}

/**
 * 清除1点濒死计数所需治疗量 = 等级 × floor(HD骰面 / 2)
 * 例：5级战士(d10) → 5 × 5 = 25
 */
function getHealThreshold(actor) {
  const level = getActorLevel(actor);
  const hdValue = getHitDieValue(actor);
  return level * Math.floor(hdValue / 2);
}

/* ---------- 濒死计数规则 ---------- */

function getInitialDyingCount(negativeHp) {
  if (negativeHp >= 50) return 3;
  if (negativeHp >= 25) return 2;
  if (negativeHp >= 10) return 1;
  return 0;
}

function getStateLabel(count) {
  if (count >= 3) return "死门";
  if (count > 0) return "濒死";
  return "正常";
}

function getStateCode(count) {
  if (count >= 3) return "door";
  if (count > 0) return "dying";
  return "0";
}

function isEnabled(actor) {
  return actor.getFlag(MODULE_ID, "enabled") === true;
}

function getDyingCount(actor) {
  return actor.getFlag(MODULE_ID, "dyingCount") ?? 0;
}

/* ---------- 注入位置查找 ---------- */

function findSummaryTarget($html) {
  // 优先找概览 tab 里的属性区，找不到就退而求其次
  const candidates = [
    '.tab[data-tab="summary"] .attributes',
    '[data-tab="summary"] .attributes',
    '.tab.summary .attributes',
    '.tab[data-tab="summary"] .summary',
    '.tab[data-tab="summary"]',
    '[data-tab="summary"]',
    '.tab.summary'
  ];
  for (const sel of candidates) {
    const $el = $html.find(sel).first();
    if ($el.length) return $el;
  }
  return null;
}

/* ---------- 角色卡注入 ---------- */

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

  const enabled = isEnabled(actor);
  const count = getDyingCount(actor);
  const threshold = getHealThreshold(actor);
  const stateLabel = getStateLabel(count);
  const stateCode = getStateCode(count);

  const panelHtml = `
    <div class="pf1-dying-panel" data-actor-id="${actor.id}">
      <div class="pf1-dying-header">
        <span class="pf1-dying-title">濒死房规</span>
        <label class="pf1-dying-toggle">
          <input type="checkbox" class="dying-enabled-toggle" ${enabled ? "checked" : ""} />
          <span>启用</span>
        </label>
      </div>
      <div class="pf1-dying-body" style="${enabled ? "" : "display:none;"}">
        <span class="pf1-dying-field">
          计数
          <input type="number" class="dying-count-input" value="${count}" min="0" max="3" step="1" />
          <span class="pf1-dying-state" data-state="${stateCode}">${stateLabel}</span>
        </span>
        <span class="pf1-dying-field">
          治疗阈值 <strong class="pf1-dying-threshold">${threshold}</strong>/点
        </span>
        <span class="pf1-dying-buttons">
          <button type="button" class="dying-calc-initial" title="按当前 HP 重新计算初始计数">按HP算</button>
          <button type="button" class="dying-apply-heal" title="输入治疗量进行计算">治疗…</button>
        </span>
      </div>
    </div>
  `;

  $target.after(panelHtml);
  const $panel = $html.find(".pf1-dying-panel");

  /* 启用切换 */
  $panel.find(".dying-enabled-toggle").on("change", async (e) => {
    const isChecked = e.target.checked;
    await actor.setFlag(MODULE_ID, "enabled", isChecked);
    $panel.find(".pf1-dying-body").toggle(isChecked);
  });

  /* 手动改计数 */
  $panel.find(".dying-count-input").on("change", async (e) => {
    let val = parseInt(e.target.value) || 0;
    val = Math.max(0, Math.min(3, val));
    e.target.value = val;
    await actor.setFlag(MODULE_ID, "dyingCount", val);
    $panel.find(".pf1-dying-state")
      .text(getStateLabel(val))
      .attr("data-state", getStateCode(val));
  });

  /* 按 HP 计算 */
  $panel.find(".dying-calc-initial").on("click", async () => {
    const hp = actor.system?.attributes?.hp?.value ?? 0;
    if (hp > 0) {
      ui.notifications.warn("角色 HP 大于 0，无需计算濒死计数。");
      return;
    }
    const initial = getInitialDyingCount(Math.abs(hp));
    await actor.setFlag(MODULE_ID, "dyingCount", initial);
    $panel.find(".dying-count-input").val(initial);
    $panel.find(".pf1-dying-state")
      .text(getStateLabel(initial))
      .attr("data-state", getStateCode(initial));
    ui.notifications.info(`初始濒死计数：${initial}`);
  });

  /* 治疗 */
  $panel.find(".dying-apply-heal").on("click", () => {
    openHealDialog(actor, $panel);
  });
});

/* ---------- 治疗对话框 ---------- */

function openHealDialog(actor, $panel) {
  const threshold = getHealThreshold(actor);
  const currentCount = getDyingCount(actor);
  const hdValue = getHitDieValue(actor);
  const level = getActorLevel(actor);

  const content = `
    <form class="pf1-dying-heal-form">
      <div class="form-group">
        <label>治疗量：</label>
        <input type="number" name="healAmount" value="0" min="0" autofocus />
      </div>
      <p class="notes">
        当前濒死计数：<strong>${currentCount}</strong><br>
        清除 1 点所需治疗：<strong>${threshold}</strong> 点
        <span style="color:#888;">（等级 ${level} × HD d${hdValue}/2）</span>
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
          const newCount = getDyingCount(actor);
          $panel.find(".dying-count-input").val(newCount);
          $panel.find(".pf1-dying-state")
            .text(getStateLabel(newCount))
            .attr("data-state", getStateCode(newCount));
        }
      },
      calcOnly: {
        icon: '<i class="fas fa-calculator"></i>',
        label: "仅计算",
        callback: (html) => {
          const heal = parseInt(html.find('[name="healAmount"]').val()) || 0;
          const r = calcHealResult(heal, threshold, currentCount);
          const msg = formatHealResult(r);
          ui.notifications.info(msg);
          ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<p>${msg}</p>`
          });
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "取消"
      }
    },
    default: "apply"
  }).render(true);
}

function calcHealResult(heal, threshold, currentCount) {
  const clearCount = Math.floor(heal / threshold);
  const overflow = heal - clearCount * threshold;
  const newCount = Math.max(0, currentCount - clearCount);
  const awakened = newCount === 0 && currentCount > 0;
  return {
    heal, threshold, currentCount, clearCount, overflow, newCount, awakened,
    awakenHp: awakened ? overflow + 1 : null
  };
}

function formatHealResult(r) {
  let msg = `治疗 ${r.heal} 点 → 清除 ${r.clearCount} 点计数（溢出 ${r.overflow} 点）。`;
  msg += `濒死计数：${r.currentCount} → ${r.newCount}。`;
  if (r.awakened) msg += ` 角色苏醒，HP 恢复至 ${r.awakenHp}。`;
  return msg;
}

async function applyHeal(actor, heal) {
  const threshold = getHealThreshold(actor);
  const currentCount = getDyingCount(actor);
  const r = calcHealResult(heal, threshold, currentCount);

  await actor.setFlag(MODULE_ID, "dyingCount", r.newCount);

  if (r.awakened) {
    await actor.update({ "system.attributes.hp.value": r.awakenHp });
  }

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong>：${formatHealResult(r)}</p>`
  });
}

/* ---------- HP 变化自动检测 ---------- */

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

  if (newHp <= 0 && oldHp > 0) {
    const initial = getInitialDyingCount(Math.abs(newHp));
    await actor.setFlag(MODULE_ID, "dyingCount", initial);

    let extra = "";
    if (initial >= 3) extra = "（计数达 3，进入死门）";

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong> 进入濒死。HP: ${newHp}，初始濒死计数：<strong>${initial}</strong> ${extra}</p>`
    });
  }
});

/* ---------- 初始化与调试 ---------- */

Hooks.once("init", () => {
  console.log("PF1E 濒死与死门房规 | 初始化");
});

Hooks.once("ready", () => {
  // 调试函数：控制台里选中 token 后输入 pf1DyingDebug()
  globalThis.pf1DyingDebug = (actor) => {
    actor = actor || canvas?.tokens?.controlled?.[0]?.actor;
    if (!actor) return console.warn("无目标角色");
    console.log("=== PF1E 濒死房规调试 ===");
    console.log("角色:", actor.name);
    console.log("等级:", getActorLevel(actor));
    console.log("actor.classes:", actor.classes);
    const classItems = (actor.items?.contents || actor.items || []).filter(i => i.type === "class");
    console.log("Class items:", classItems.map(i => ({ name: i.name, hd: i.system?.hd })));
    console.log("提取的 HD 骰面值:", getHitDieValue(actor));
    console.log("治疗阈值:", getHealThreshold(actor));
  };
  console.log("PF1E 濒死与死门房规 | 就绪。调试命令：pf1DyingDebug()");
});
