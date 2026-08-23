(function () {
  "use strict";

  // ---------- Fixed schedule constants ----------
  var TOTAL_DAYS = 12;
  var DEADLINE_DAY = 8;

  var DESIGN_START = 1;
  var DESIGN_DURATION = 5; // Days 1-5, fixed

  var LEGAL_DURATION = 4; // Legal always spans 4 days
  var MAX_SUBMISSIONS = 3;

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
  var resultText = document.getElementById("resultText");

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

    // Keep the bar renderable within the visible 1-12 day axis.
    legalStart = Math.max(1, Math.min(TOTAL_DAYS - LEGAL_DURATION + 1, legalStart));

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
  function addBubble(text, who) {
    var bubble = document.createElement("div");
    bubble.className = "bubble " + who;
    bubble.textContent = text;
    chatHistory.appendChild(bubble);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  // Position updates live as the learner adjusts the dependency type or
  // lag. Judgment colors are NOT recomputed here — any control change
  // drops back to the pending look until the next submit.
  function handleControlChange() {
    if (state.sessionOver) return;
    renderChart(false);
    resultText.textContent = "";
    resultText.className = "result";
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

  function handleSubmit() {
    if (state.sessionOver) return;

    var reasoning = reasoningInput.value.trim();
    if (!reasoning) {
      reasoningInput.focus();
      return;
    }

    state.submissionCount += 1;

    // Determine the outcome for whatever configuration is active right
    // now, then render the chart directly against it — this is the only
    // place judgment colors get applied.
    var schedule = currentSchedule();
    var success = schedule.launchDay <= DEADLINE_DAY;
    var missBy = success ? 0 : schedule.launchDay - DEADLINE_DAY;

    renderChart(true, success);

    addBubble(reasoning, "user");

    var aiText = success
      ? "[AI evaluation would appear here — deadline met]"
      : "[AI evaluation would appear here — schedule still misses the deadline]";
    addBubble(aiText, "ai");

    resultText.textContent = success
      ? "Launch lands on Day " + schedule.launchDay + " — meets the Day " + DEADLINE_DAY + " deadline."
      : "Launch lands on Day " + schedule.launchDay + " — misses the Day " + DEADLINE_DAY +
        " deadline by " + missBy + " day" + (missBy === 1 ? "" : "s") + ".";
    resultText.className = "result " + (success ? "success" : "miss");

    if (success || state.submissionCount >= MAX_SUBMISSIONS) {
      endSession();
    } else {
      reasoningInput.value = "";
      reasoningInput.placeholder = "Type your revised reasoning here...";
      submitBtn.textContent = "Try Again";
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
