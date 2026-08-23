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

  // ---------- Scheduling math ----------
  // Returns { legalStart, launchDay }
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

  // ---------- Rendering ----------
  function makeDot(day, className) {
    var dot = document.createElement("div");
    dot.className = "dot " + className;
    dot.style.gridColumn = day + " / " + (day + 1);
    return dot;
  }

  function renderDesign() {
    designDots.innerHTML = "";
    for (var d = DESIGN_START; d < DESIGN_START + DESIGN_DURATION; d++) {
      designDots.appendChild(makeDot(d, "design"));
    }
  }

  // Legal has no pass/fail of its own — each dot is colored by whether
  // that individual day falls on/after the Day 8 deadline. It never turns
  // green; only Launch's single outcome dot does.
  function renderLegal(legalStart) {
    legalDots.innerHTML = "";
    for (var d = legalStart; d < legalStart + LEGAL_DURATION; d++) {
      if (d < 1 || d > TOTAL_DAYS) continue;
      var cls = "legal" + (d >= DEADLINE_DAY ? " legal-late" : "");
      legalDots.appendChild(makeDot(d, cls));
    }
  }

  function renderLaunch(launchDay, outcome) {
    launchDots.innerHTML = "";
    var day = Math.max(1, Math.min(TOTAL_DAYS, launchDay));
    var cls = "launch";
    if (outcome === "miss") cls += " miss";
    if (outcome === "success") cls += " success";
    launchDots.appendChild(makeDot(day, cls));
  }

  function currentInputs() {
    var lag = parseInt(lagInput.value, 10);
    if (isNaN(lag)) lag = 0;
    return { depType: depTypeSelect.value, lag: lag };
  }

  // Renders the chart for a given outcome ("default", "miss", or "success").
  // Used for the unsubmitted/adjusted state, where Launch has no verdict yet.
  function renderSchedule(outcome) {
    var inputs = currentInputs();
    var schedule = computeSchedule(inputs.depType, inputs.lag);
    renderDesign();
    renderLegal(schedule.legalStart);
    renderLaunch(schedule.launchDay, outcome);
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

  depTypeSelect.addEventListener("change", function () {
    if (!state.sessionOver) renderSchedule("default");
  });
  lagInput.addEventListener("change", function () {
    if (!state.sessionOver) renderSchedule("default");
  });

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

    // Compute the schedule once, determine the outcome, then render the
    // chart directly against that outcome — Launch's dot color is a
    // straight function of this same "success" value used everywhere else.
    var inputs = currentInputs();
    var schedule = computeSchedule(inputs.depType, inputs.lag);
    var success = schedule.launchDay <= DEADLINE_DAY;
    var missBy = success ? 0 : schedule.launchDay - DEADLINE_DAY;

    renderDesign();
    renderLegal(schedule.legalStart);
    renderLaunch(schedule.launchDay, success ? "success" : "miss");

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
    renderSchedule("default");
  }

  init();
})();
