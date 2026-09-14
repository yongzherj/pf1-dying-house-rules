/* ============================================================
 * PF1E 濒死与死门房规（半自动版）
 * 默认关闭，需在角色卡上勾选启用
 * ============================================================ */

const MODULE_ID = "pf1-dying-house-rules";

/* ---------- 工具函数 ---------- */

/**
 * 根据负生命值计算初始濒死计数（规则2）
 * @param {number} negativeHp - 负生命值的绝对值
 * @returns {number} 初始濒死计数 0~3
 */
function getInitialDyingCount(negativeHp) {
  if (negativeHp >= 50) return 3;
  if (negativeHp >= 25) return 2;
  if (negativeHp >= 10) return 1;
  return 0;
}

/**
 * 根据 HD 骰面获取治疗系数（规则5.1）
 */
function getHealCoefficient(die) {
  const map = { d6: 3, d8: 4, d10: 5, d12: 6 };
  return map[die] || 4;
}

/**
 * 计算清除1点濒死计数所需治疗量
 */
function getHealThreshold(actor) {
  const level = actor.system?.attributes?.hd?.total || 1;
  const die = actor.system?.attributes?.hd?.die || "d8";
  return level * getHealCoefficient(die);
}

/**
 * 获取状态文字
 */
function getStateLabel(count) {
  if (count >= 3) return "死门";
  if (count > 0) return "濒死";
  return "正常";
}

function isEnabled(actor) {
  return actor.getFlag(MODULE_ID, "enabled") === true;
}

function getDyingCount(actor) {
  return actor.getFlag(MODULE_ID, "dyingCount") ?? 0;
}

/* ---------- 角色卡注入 ---------- */

Hooks.on("renderActorSheet", (app, html, data) => {
  const actor = app.actor;
  if (!actor || actor.type !== "character") return;

  const $html = html instanceof jQuery ? html : $(html);

  // 避免重复注入
  if ($html.find(".pf1-dying-panel").length > 0) return;

  const enabled = isEnabled(actor);
  const count = getDyingCount(actor);
  const threshold = getHealThreshold(actor);
  const stateLabel = getStateLabel(count);

  const panelHtml = `
    <div class="pf1-dying-panel" data-actor-id="${actor.id}">
      <header class="pf1-dying-header">
        <label class="pf1-dying-toggle">
          <input type="checkbox" class="dying-enabled-toggle" ${enabled ? "checked" : ""} />
          <span>启用濒死房规</span>
        </label>
      </header>
      <div class="pf1-dying-body" style="${enabled ? "" : "display:none;"}">
        <div class="pf1-dying-row">
          <span class="pf1-dying-label">濒死计数:</span>
          <input type="number" class="dying-count-input" value="${count}" min="0" max="3" step="1" />
          <span class="pf1-dying-state">${stateLabel}</span>
        </div>
        <div class="pf1-dying-row">
          <span class="pf1-dying-label">治疗阈值:</span>
          <span class="pf1-dying-value">${threshold} 点 / 计数</span>
        </div>
        <div class="pf1-dying-row pf1-dying-actions">
          <button type="button" class="dying-calc-initial">按 HP 计算</button>
          <button type="button" class="dying-apply-heal">应用治疗…</button>
        </div>
      </div>
    </div>
  `;

  // 选择注入位置：优先 sheet-header，其次 form 顶部
  const $header = $html.find(".sheet-header").first();
  const $form = $html.find("form").first();
  const $target = $header.length ? $header : ($form.length ? $form : $html);
  $target.prepend(panelHtml);

  const $panel = $html.find(".pf1-dying-panel");

  /* ----- 事件绑定 ----- */

  // 启用切换
  $panel.find(".dying-enabled-toggle").on("change", async (e) => {
    const isChecked = e.target.checked;
    await actor.setFlag(MODULE_ID, "enabled", isChecked);
    $panel.find(".pf1-dying-body").toggle(isChecked);
  });

  // 手动修改计数
  $panel.find(".dying-count-input").on("change", async (e) => {
    let val = parseInt(e.target.value) || 0;
    val = Math.max(0, Math.min(3, val));
    e.target.value = val;
    await actor.setFlag(MODULE_ID, "dyingCount", val);
    $panel.find(".pf1-dying-state").text(getStateLabel(val));
  });

  // 按 HP 计算初始计数
  $panel.find(".dying-calc-initial").on("click", async () => {
    const hp = actor.system?.attributes?.hp?.value ?? 0;
    if (hp > 0) {
      ui.notifications.warn("角色 HP 大于 0，无需计算濒死计数。");
      return;
    }
    const initial = getInitialDyingCount(Math.abs(hp));
    await actor.setFlag(MODULE_ID, "dyingCount", initial);
    $panel.find(".dying-count-input").val(initial);
    $panel.find(".pf1-dying-state").text(getStateLabel(initial));
    ui.notifications.info(`初始濒死计数：${initial}`);
  });

  // 应用治疗
  $panel.find(".dying-apply-heal").on("click", () => {
    openHealDialog(actor, $panel);
  });
});

/* ---------- 治疗对话框 ---------- */

function openHealDialog(actor, $panel) {
  const threshold = getHealThreshold(actor);
  const currentCount = getDyingCount(actor);

  const content = `
    <form>
      <div class="form-group">
        <label>治疗量:</label>
        <input type="number" name="healAmount" value="0" min="0" autofocus />
      </div>
      <p class="notes" style="margin-top:6px;">
        当前濒死计数：<strong>${currentCount}</strong><br>
        清除 1 点计数需要：<strong>${threshold}</strong> 点治疗
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
          $panel.find(".pf1-dying-state").text(getStateLabel(newCount));
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

/**
 * 计算治疗结果（规则5）
 */
function calcHealResult(heal, threshold, currentCount) {
  const clearCount = Math.floor(heal / threshold);
  const overflow = heal - clearCount * threshold;
  const newCount = Math.max(0, currentCount - clearCount);
  const awakened = newCount === 0 && currentCount > 0;
  return {
    heal,
    threshold,
    currentCount,
    clearCount,
    overflow,
    newCount,
    awakened,
    awakenHp: awakened ? overflow + 1 : null
  };
}

function formatHealResult(r) {
  let msg = `治疗 ${r.heal} 点 → 清除 ${r.clearCount} 点计数（溢出 ${r.overflow} 点）。`;
  msg += `濒死计数：${r.currentCount} → ${r.newCount}。`;
  if (r.awakened) {
    msg += ` 角色苏醒，HP 恢复至 ${r.awakenHp}。`;
  }
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

/* ---------- HP 变化自动检测（仅用于初始化计数） ---------- */

// preUpdateActor 中缓存旧值/新值
Hooks.on("preUpdateActor", (actor, change, options, userId) => {
  const newHp = foundry.utils.getProperty(change, "system.attributes.hp.value");
  if (newHp === undefined) return;

  const oldHp = actor.system?.attributes?.hp?.value;
  if (oldHp === undefined) return;

  actor._pf1DyingOldHp = oldHp;
  actor._pf1DyingNewHp = newHp;
});

// updateActor 中根据 HP 变化决定是否写入初始计数
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

    let extra = "";
    if (initial >= 3) extra = "（计数已达 3，进入死门）";
    else if (initial === 0) extra = "（计数为 0）";

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${actor.name}</strong> 进入濒死。HP: ${newHp}，初始濒死计数：<strong>${initial}</strong> ${extra}</p>`
    });
  }
});

/* ---------- 初始化 ---------- */

Hooks.once("init", () => {
  console.log("PF1E 濒死与死门房规 | 初始化");
});

Hooks.once("ready", () => {
  console.log("PF1E 濒死与死门房规 | 就绪");
});