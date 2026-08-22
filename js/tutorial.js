/* tutorial.js — numbered callout circles for the *_tutorial study conditions
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope.

   ?condition=single_tutorial runs the `single` condition exactly as it normally
   runs and draws numbered circles over the parts of the screen a walkthrough
   refers to. To number another condition, add its base key to TUTORIAL_BADGES.

   The callouts are two tiers. A, B, C name the three stacked sections -- Input
   Case, Prediction, Performance -- because those are what the screen is built
   out of. The numbers then run 1..n straight through the parts inside them,
   continuing across section boundaries rather than restarting, so a walkthrough
   can say "A, then 1 and 2" and later "C, then 5 and 6" without any number
   meaning two different things.

   Each entry pins one circle:
     n        what goes in the circle: "A" for a section, a number for a part
              inside one, "3a"/"3b" when the multi-model screen has one per model
     selector CSS selector matched against the whole page
     index    which match to use when the selector hits several elements (0)
     place    where the circle sits: "above" (default), "left", "right",
              "below", "inside"
     muted    grey rather than blue -- a part an earlier stage already covered,
              kept labelled so the lettering and numbering stay continuous
     title    optional hover text; {self}/{other} become the stage's column names

   The badge is absolutely positioned inside the anchor, so it never becomes a
   grid or flex item of it and never moves the layout it annotates. */

    // The single / single-optimal panel, read top to bottom: the case, what the
    // AI predicted for it, and how well that AI scores on the criteria.
    const TUTORIAL_SINGLE_BADGES = [
      { n: "A", selector: ".single-row-label", index: 0, place: "left", title: "The case being decided" },
      { n: 1, selector: ".single-input-heads .single-attr-heading", title: "Which attribute of the case" },
      { n: 2, selector: ".single-input-heads .single-value-heading", title: "This case's value for it" },
      { n: "B", selector: ".single-row-label", index: 1, place: "left", title: "What the AI system decided" },
      { n: 3, selector: ".single-prediction-result", place: "right", title: "The predicted class" },
      { n: 4, selector: ".single-explanation-link", place: "right", title: "Opens which attributes pushed the prediction" },
      { n: "C", selector: ".single-row-label", index: 2, place: "left", title: "How good that AI is, for people like this case" },
      { n: 5, selector: ".single-performance-heads .single-criteria-heading", title: "Which quality criterion" },
      { n: 6, selector: ".single-performance-heads .single-score-heading", title: "Its score, 100% is perfect" },
    ];

    // The multi-optimal panel is the single panel with a second model column, so
    // it keeps the same lettering and numbering: the parts that now exist once
    // per model split into a (first column) and b (second), and the parts the
    // single stage already explained -- the three sections and the case
    // attributes -- keep their labels but go grey.
    const TUTORIAL_MULTI_OPTIMAL_BADGES = [
      { n: "A", selector: ".multi-stack-diagram .single-row-label", index: 0, place: "left", muted: true, title: "The case being decided" },
      { n: 1, selector: ".multi-optimal-case-list .single-attr-heading", muted: true, title: "Which attribute of the case" },
      { n: 2, selector: ".multi-optimal-case-list .single-value-heading", muted: true, title: "This case's value for it" },
      { n: "B", selector: ".multi-stack-diagram .single-row-label", index: 1, place: "left", muted: true, title: "What the AI systems decided" },
      // a hangs off the left of the two columns, b off the right, so the circles
      // stay clear of the predictions without the columns widening to hold them.
      { n: "3a", selector: ".multi-optimal-prediction-value", index: 0, place: "left", title: "The class {self} predicted" },
      { n: "3b", selector: ".multi-optimal-prediction-value", index: 1, place: "right", title: "The class {other} predicted" },
      { n: "4a", selector: ".multi-prediction-section .multi-optimal-detail-wrap", index: 0, place: "left", title: "Opens which attributes pushed {self}'s prediction" },
      { n: "4b", selector: ".multi-prediction-section .multi-optimal-detail-wrap", index: 1, place: "right", title: "Opens which attributes pushed {other}'s prediction" },
      { n: "C", selector: ".multi-stack-diagram .single-row-label", index: 2, place: "left", muted: true, title: "How good each AI is, for people like this case" },
      { n: 5, selector: ".multi-optimal-table .exposure-performance-criteria-heading", title: "Which quality criterion" },
      { n: "6a", selector: ".multi-optimal-table > .multi-optimal-corner", index: 0, place: "inside", title: "{self}'s scores, 100% is perfect" },
      { n: "6b", selector: ".multi-optimal-table > .multi-optimal-corner", index: 1, place: "inside", title: "{other}'s scores, 100% is perfect" },
    ];

    // Aggregate is the next walkthrough step. The comparison screen has already
    // been taught, so all of its callouts recede to grey and only the new
    // importance slider is introduced in blue.
    const TUTORIAL_AGGREGATE_BADGES = [
      ...TUTORIAL_MULTI_OPTIMAL_BADGES.map((item) => ({ ...item, muted: true })),
      { n: 7, selector: ".aggregate-slider-wrap", place: "tight-left", title: "Adjust how much each stakeholder's model influences the aggregate recommendation" },
      { n: 8, selector: ".aggregate-result", place: "tight-left", title: "The recommendation produced by aggregating the two models" },
    ];

    // Negotiation is the fourth tutorial section. Everything already explained
    // on the stakeholder-comparison screen remains numbered but steps back to
    // grey; only D and the new negotiation controls are blue.
    const TUTORIAL_NEGOTIATE_V2_BADGES = [
      ...TUTORIAL_MULTI_OPTIMAL_BADGES.map((item) => ({ ...item, muted: true })),
      { n: "D", selector: ".negotiation-panel", place: "top-left", title: "The negotiation workspace" },
      // Native selects cannot contain a badge, so each version badge anchors
      // to the role wrapper immediately around its dropdown.
      { n: "7a", selector: ".negotiate-v2-model-version-wrap", index: 0, place: "tight-left", title: "Review my current or earlier model version" },
      { n: "7b", selector: ".negotiate-v2-model-version-wrap", index: 1, place: "tight-right", title: "Review the Other-party's current or earlier model version" },
      { n: "8a", selector: ".tutorial-history-original", place: "above", title: "Both sides' original positions" },
      { n: "8b", selector: ".tutorial-history-my-offer", place: "right", title: "An example of my offer" },
      { n: "8c", selector: ".tutorial-history-other-offer", place: "left", title: "An example of the Other-party's offer" },
      // A select cannot reliably contain a span, so the badge anchors to the
      // field that wraps it while still pointing at the model list itself.
      { n: "9a", selector: ".negotiate-v2-model-offer-wrap", place: "tight-above", title: "Choose the model to offer" },
      { n: "9b", selector: "#nv2OtherOpensButton", place: "above", title: "Let the Other-party make the first move" },
      { n: "9c", selector: "#nv2HoldButton", place: "above", title: "Keep my current model" },
      { n: "9d", selector: "#nv2SendButton", place: "above", title: "Send the selected offer" },
    ];

    // Keyed by walkthrough stage first, then by condition so that opening any
    // condition with `_tutorial` still gets whatever that condition has. The
    // multiplicity and multistakeholder stages annotate the same screen and so
    // share one spec; {self}/{other} in a title pick up that stage's column
    // names, Model 1 / Model 2 on one and My / Other model on the next.
    const TUTORIAL_BADGES = {
      single: TUTORIAL_SINGLE_BADGES,
      singleoptimal: TUTORIAL_SINGLE_BADGES,
      multiplicity: TUTORIAL_MULTI_OPTIMAL_BADGES,
      multistakeholder: TUTORIAL_MULTI_OPTIMAL_BADGES,
      multioptimal: TUTORIAL_MULTI_OPTIMAL_BADGES,
      aggregate: TUTORIAL_AGGREGATE_BADGES,
      negotiatev2: TUTORIAL_NEGOTIATE_V2_BADGES,
    };

    function tutorialBadgeSpec() {
      if (!isTutorialMode()) return [];
      return TUTORIAL_BADGES[tutorialStage()] || TUTORIAL_BADGES[studyCondition()] || [];
    }

    function tutorialBadgeTitle(title) {
      return String(title || "")
        .replaceAll("{self}", modelRoleLabel("self", "My model"))
        .replaceAll("{other}", modelRoleLabel("other", "Other model"));
    }

    function clearTutorialBadges() {
      document.querySelectorAll(".tutorial-badge").forEach((badge) => badge.remove());
      document.querySelectorAll(".tutorial-anchor").forEach((anchor) => anchor.classList.remove("tutorial-anchor"));
    }

    function renderTutorialBadges() {
      clearTutorialBadges();
      tutorialBadgeSpec().forEach((item) => {
        const anchor = document.querySelectorAll(item.selector)[item.index || 0];
        if (!anchor) return;
        const label = String(item.n);
        // A/B/C are the section tier, so they are drawn as a square rather than
        // a circle -- the two tiers have to be tellable apart at a glance, and
        // the letter alone is easy to read as just another item in the sequence.
        const isSection = /^[A-Z]$/.test(label);
        const badge = document.createElement("span");
        badge.className = [
          "tutorial-badge",
          `tutorial-badge-${item.place || "above"}`,
          item.muted ? "tutorial-badge-muted" : "",
          isSection ? "tutorial-badge-section" : "",
          label.length > 1 ? "tutorial-badge-pair" : "",
        ].filter(Boolean).join(" ");
        badge.textContent = label;
        if (item.title) badge.title = tutorialBadgeTitle(item.title);
        badge.setAttribute("aria-hidden", "true");
        anchor.classList.add("tutorial-anchor");
        anchor.appendChild(badge);
      });
    }

    // The panels re-render on every offer, weight change and case switch, which
    // drops the badges with them. Rather than hooking each render path, watch the
    // page and re-place them; the observer is disconnected while placing so our
    // own insertions do not re-trigger it.
    function watchTutorialBadges() {
      if (!tutorialBadgeSpec().length) return;
      let queued = false;
      const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          observer.disconnect();
          renderTutorialBadges();
          observer.observe(document.body, { childList: true, subtree: true });
        });
      });
      renderTutorialBadges();
      observer.observe(document.body, { childList: true, subtree: true });
    }

    watchTutorialBadges();
