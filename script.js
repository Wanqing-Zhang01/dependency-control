(function () {
  "use strict";

  // ---------- Fixed schedule constants ----------
  var TOTAL_DAYS = 12;
  var DEADLINE_DAY = 8;

  var DESIGN_START = 1;
  var DESIGN_DURATION = 5; // Days 1-5, fixed

  var LEGAL_DURATION = 4; // Legal always spans 4 days
  var MAX_SUBMISSIONS = 3;

  // The Cloudflare Worker that proxies to Gemini (see worker/README.md
  // for the request/response shape this calls).
  var WORKER_URL = "https://dependency-control-coach.wanqingzhang01.workers.dev";

  // fetch() has no built-in timeout — a stalled connection or a response
  // that never finishes streaming (either leg: browser<->Worker or
  // Worker<->Gemini) hangs forever with nothing to catch, leaving the
  // learner stuck on "Thinking..." with no way to recover. Abort and
  // fail into the normal error-bubble path instead.
  var REQUEST_TIMEOUT_MS = 18000;

  // ---------- State ----------
  var state = {
    submissionCount: 0,
    sessionOver: false,
  };

  // ---------- Element references ----------
  var axisCells = document.getElementById("axisCells");
  var designDots = document.getElementById("designDots");
  var legalDots = document.getElementById("legalDots");
  var launchDots = document.getElementById("launchDots");
  var depTypeSelect = document.getElementById("depType");
  var lagInput = document.getElementById("lagInput");
  var reasoningInput = document.getElementById("reasoning");
  var submitBtn = document.getElementById("submitBtn");
  var chatHistory = document.getElementById("chatHistory");

  // ---------- Axis ----------
  function buildAxis() {
    for (var day = 1; day <= TOTAL_DAYS; day++) {
      var span = document.createElement("span");
      span.textContent = String(day);
      if (day === DEADLINE_DAY) {
        span.className = "deadline-day";
      }
      axisCells.appendChild(span);
    }
  }

  // ---------- Scheduling math (position only — no color/judgment here) ----------
  function computeSchedule(depType, lag) {
    var legalStart;
    if (depType === "ss") {
      // Start-to-Start: Legal starts relative to Design's start
      legalStart = DESIGN_START + lag;
    } else {
      // Finish-to-Start: Legal starts relative to Design's finish
      legalStart = DESIGN_START + DESIGN_DURATION + lag;
    }

    // Deliberately not clamped here: legalStart (and therefore launchDay)
    // must reflect the true math for both dependency types symmetrically,
    // since deadlineMet/daysOverBy are derived from it. Clamping used to
    // live here, but Start-to-Start's baseline (Design's start, day 1) is
    // already at the axis floor, so any negative lag was silently clamped
    // straight back to day 1 — freezing Legal *and* Launch, and quietly
    // making the pass/fail math wrong too. Rendering (renderLegal's
    // per-dot skip, renderLaunch's display clamp) already handles values
    // that fall outside the visible 1-12 axis.
    var legalEnd = legalStart + LEGAL_DURATION - 1;

    // Launch is a single-day event, Finish-to-Start from Legal, 0 lag.
    var launchDay = legalEnd + 1;

    return { legalStart: legalStart, legalEnd: legalEnd, launchDay: launchDay };
  }

  function currentInputs() {
    var lag = parseInt(lagInput.value, 10);
    if (isNaN(lag)) lag = 0;
    return { depType: depTypeSelect.value, lag: lag };
  }

  function currentSchedule() {
    var inputs = currentInputs();
    return computeSchedule(inputs.depType, inputs.lag);
  }

  // The Worker/Gemini context expects the readable form, not our "ss"/"fs"
  // option values.
  function readableDependencyType(depType) {
    return depType === "ss" ? "start-to-start" : "finish-to-start";
  }

  // ---------- Dot rendering ----------
  function makeDot(day, className) {
    var dot = document.createElement("div");
    dot.className = "dot " + className;
    dot.style.gridColumn = day + " / " + (day + 1);
    return dot;
  }

  // Design is fixed and never evaluated — always blue.
  function renderDesign() {
    designDots.innerHTML = "";
    for (var d = DESIGN_START; d < DESIGN_START + DESIGN_DURATION; d++) {
      designDots.appendChild(makeDot(d, "design"));
    }
  }

  // Legal has no pass/fail of its own. Before submit (or while the learner
  // is repositioning it), every dot is plain blue — no judgment is shown.
  // Only after submit does each dot color individually by its own day:
  // red if that day is >= 8, blue otherwise. It never turns green.
  function renderLegal(legalStart, evaluated) {
    legalDots.innerHTML = "";
    for (var d = legalStart; d < legalStart + LEGAL_DURATION; d++) {
      if (d < 1 || d > TOTAL_DAYS) continue;
      var late = evaluated && d >= DEADLINE_DAY;
      legalDots.appendChild(makeDot(d, "legal" + (late ? " legal-late" : "")));
    }
  }

  // Launch's dot is gray ("pending") before submit or while repositioning.
  // Only after submit does it become green (meets the deadline) or red
  // (misses it) — outcome is "pending", "success", or "miss".
  function renderLaunch(launchDay, outcome) {
    launchDots.innerHTML = "";
    var day = Math.max(1, Math.min(TOTAL_DAYS, launchDay));
    var cls = "launch";
    if (outcome === "miss") cls += " miss";
    if (outcome === "success") cls += " success";
    launchDots.appendChild(makeDot(day, cls));
  }

  // Single entry point for drawing the whole chart. `evaluated` gates
  // color/judgment: false = positions only, everything in its default
  // pending look; true = judgment colors applied for the given outcome.
  function renderChart(evaluated, success) {
    var schedule = currentSchedule();
    renderDesign();
    renderLegal(schedule.legalStart, evaluated);
    renderLaunch(schedule.launchDay, evaluated ? (success ? "success" : "miss") : "pending");
    return schedule;
  }

  // ---------- Chat ----------
  // Returns the bubble element so callers can update it later (e.g. swap
  // a "Thinking..." placeholder for the real response).
  function addBubble(text, who) {
    var bubble = document.createElement("div");
    bubble.className = "bubble " + who;
    bubble.textContent = text;
    chatHistory.appendChild(bubble);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return bubble;
  }

  function setBubble(bubble, text, who) {
    bubble.className = "bubble " + who;
    bubble.textContent = text;
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  // Position updates live as the learner adjusts the dependency type or
  // lag. Judgment colors are NOT recomputed here — any control change
  // drops back to the pending look until the next submit.
  function handleControlChange() {
    if (state.sessionOver) return;
    renderChart(false);
  }

  depTypeSelect.addEventListener("change", handleControlChange);
  lagInput.addEventListener("input", handleControlChange);

  // ---------- Submit flow ----------
  function endSession() {
    state.sessionOver = true;
    depTypeSelect.disabled = true;
    lagInput.disabled = true;
    reasoningInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Session Complete";
  }

  function setControlsDisabled(disabled) {
    depTypeSelect.disabled = disabled;
    lagInput.disabled = disabled;
    reasoningInput.disabled = disabled;
    submitBtn.disabled = disabled;
  }

  function retryButtonLabel() {
    return state.submissionCount === 0 ? "Submit for evaluation" : "Try Again";
  }

  // Puts the controls back the way they were before this (failed) attempt,
  // so a transient error never costs the learner a try or locks them out.
  // Reasoning is deliberately left as-is here — a network/upstream error
  // isn't a comment on what they typed, so there's no reason to make them
  // retype it.
  function recoverControlsAfterFailure() {
    setControlsDisabled(false);
    submitBtn.textContent = retryButtonLabel();
  }

  // Re-enables controls for another attempt after a decline or a genuine
  // miss under the cap, clearing the reasoning textarea back to its
  // placeholder so the learner starts their next attempt fresh.
  function resetControlsForAnotherAttempt() {
    setControlsDisabled(false);
    reasoningInput.value = "";
    reasoningInput.placeholder = "Type your revised reasoning here...";
    submitBtn.textContent = retryButtonLabel();
  }

  function friendlyErrorMessage(status, body) {
    if (status === "timeout") {
      return "The AI coach is taking too long to respond. Please try submitting again.";
    }
    if (status === 429) {
      return body && body.error
        ? body.error
        : "You've hit the limit for AI feedback requests right now. Please wait a bit and try again.";
    }
    if (body && body.error) {
      return "The AI coach ran into a problem: " + body.error + " Please try submitting again.";
    }
    return "Couldn't reach the AI coach right now. Please check your connection and try submitting again.";
  }

  async function handleSubmit() {
    if (state.sessionOver) return;

    var reasoning = reasoningInput.value.trim();
    if (!reasoning) {
      reasoningInput.focus();
      return;
    }

    // Determine the outcome for whatever configuration is active right
    // now. This is purely our own math and doesn't depend on the AI call
    // below — but applying it to the chart (judgment colors) waits until
    // the response comes back and confirms this was a genuine evaluation,
    // not a decline: a declined submission wasn't actually evaluated, so
    // the dots must stay in their pre-submission pending look.
    var schedule = currentSchedule();
    var success = schedule.launchDay <= DEADLINE_DAY;
    var missBy = success ? 0 : schedule.launchDay - DEADLINE_DAY;

    addBubble(reasoning, "user");
    var aiBubble = addBubble("Thinking...", "ai thinking");

    setControlsDisabled(true);
    submitBtn.textContent = "Evaluating...";

    var inputs = currentInputs();
    var payload = {
      dependencyType: readableDependencyType(inputs.depType),
      lag: inputs.lag,
      legalStart: schedule.legalStart,
      legalEnd: schedule.legalEnd,
      launchDay: schedule.launchDay,
      deadlineMet: success,
      daysOverBy: missBy,
      learnerReasoning: reasoning,
    };

    var controller = new AbortController();
    var timedOut = false;
    var timeoutId = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    var res, data;
    try {
      res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      data = await res.json().catch(function () {
        return null;
      });
    } catch (err) {
      // Network failure, CORS block, DNS, timeout (AbortError), etc. —
      // transient; don't cost the learner an attempt or lock them out.
      setBubble(aiBubble, friendlyErrorMessage(timedOut ? "timeout" : null, null), "ai error");
      recoverControlsAfterFailure();
      return;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      setBubble(aiBubble, friendlyErrorMessage(res.status, data), "ai error");
      recoverControlsAfterFailure();
      return;
    }

    var feedback = data && data.feedback ? data.feedback : "The AI coach didn't return a response. Please try submitting again.";
    setBubble(aiBubble, feedback, "ai");

    // A decline (the Worker's Step 1: the reasoning wasn't a genuine
    // attempt) is not a real evaluation — the learner hasn't actually
    // attempted the task yet. No judgment colors, no attempt consumed,
    // no session lock; just clear the textarea and let them try again.
    if (data && data.declined) {
      resetControlsForAnotherAttempt();
      return;
    }

    // A genuine evaluation happened — now it's safe to apply judgment
    // colors to the chart.
    renderChart(true, success);

    state.submissionCount += 1;

    if (success || state.submissionCount >= MAX_SUBMISSIONS) {
      endSession();
    } else {
      resetControlsForAnotherAttempt();
    }
  }

  submitBtn.addEventListener("click", handleSubmit);

  // ---------- Init ----------
  function init() {
    buildAxis();
    addBubble(
      "I am your PM Coach. Make your visual adjustments to the timeline, then type your reasoning below to submit for evaluation.",
      "ai"
    );
    renderChart(false);
  }

  init();
})();
