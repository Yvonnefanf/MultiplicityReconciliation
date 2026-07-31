/* tutorial.js — numbered callout circles for the *_tutorial study conditions
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope.

   ?condition=single_tutorial runs the `single` condition exactly as it normally
   runs and draws numbered circles over the parts of the screen a walkthrough
   refers to. To number another condition, add its base key to TUTORIAL_BADGES.

   Each entry pins one circle:
     n        the number in the circle ("5a" and friends are fine)
     selector CSS selector matched against the whole page
     index    which match to use when the selector hits several elements (0)
     place    where the circle sits: "above" (default), "left", "right",
              "below", "inside"
     muted    grey rather than blue -- a part an earlier screen already covered,
              kept numbered so the walkthrough's numbering stays continuous
     title    optional hover text

   The badge is absolutely positioned inside the anchor, so it never becomes a
   grid or flex item of it and never moves the layout it annotates. */

    // The single / single-optimal panel, read left to right: the case, what the
    // AI predicted for it, and how well that AI scores on the criteria.
    const TUTORIAL_SINGLE_BADGES = [
      { n: 1, selector: ".single-row-label", index: 0, place: "left", title: "The case being decided" },
      { n: 2, selector: ".single-input-heads .single-attr-heading", title: "Which attribute of the case" },
      { n: 3, selector: ".single-input-heads .single-value-heading", title: "This case's value for it" },
      { n: 4, selector: ".single-row-label", index: 1, place: "left", title: "What the AI system decided" },
      { n: 5, selector: ".single-prediction-result", place: "right", title: "The predicted class" },
      { n: 6, selector: ".single-explanation-link", place: "right", title: "Opens which attributes pushed the prediction" },
      { n: 7, selector: ".single-row-label", index: 2, place: "left", title: "How good that AI is, for people like this case" },
      { n: 8, selector: ".single-performance-heads .single-criteria-heading", title: "Which quality criterion" },
      { n: 9, selector: ".single-performance-heads .single-score-heading", title: "Its score, 100% is perfect" },
    ];

    // The multi-optimal panel is the single panel with a second model column, so
    // it reuses the same numbering: the parts that now exist once per model are
    // lettered a (Model 1) and b (Model 2), and the parts the single walkthrough
    // already explained -- the three section titles and the case attributes --
    // stay numbered but go grey.
    const TUTORIAL_MULTI_OPTIMAL_BADGES = [
      { n: 1, selector: ".multi-stack-diagram .single-row-label", index: 0, place: "left", muted: true, title: "The case being decided" },
      { n: 2, selector: ".multi-optimal-case-list .single-attr-heading", muted: true, title: "Which attribute of the case" },
      { n: 3, selector: ".multi-optimal-case-list .single-value-heading", muted: true, title: "This case's value for it" },
      { n: 4, selector: ".multi-stack-diagram .single-row-label", index: 1, place: "left", muted: true, title: "What the AI systems decided" },
      // a hangs off the left of the two columns, b off the right, so the circles
      // stay clear of the predictions without the columns widening to hold them.
      { n: "5a", selector: ".multi-optimal-prediction-value", index: 0, place: "left", title: "The class Model 1 predicted" },
      { n: "5b", selector: ".multi-optimal-prediction-value", index: 1, place: "right", title: "The class Model 2 predicted" },
      { n: "6a", selector: ".multi-prediction-section .multi-optimal-detail-wrap", index: 0, place: "left", title: "Opens which attributes pushed Model 1's prediction" },
      { n: "6b", selector: ".multi-prediction-section .multi-optimal-detail-wrap", index: 1, place: "right", title: "Opens which attributes pushed Model 2's prediction" },
      { n: 7, selector: ".multi-stack-diagram .single-row-label", index: 2, place: "left", muted: true, title: "How good each AI is, for people like this case" },
      { n: 8, selector: ".multi-optimal-table .exposure-performance-criteria-heading", title: "Which quality criterion" },
      { n: "9a", selector: ".multi-optimal-table > .multi-optimal-corner", index: 0, place: "inside", title: "Model 1's scores, 100% is perfect" },
      { n: "9b", selector: ".multi-optimal-table > .multi-optimal-corner", index: 1, place: "inside", title: "Model 2's scores, 100% is perfect" },
    ];

    const TUTORIAL_BADGES = {
      single: TUTORIAL_SINGLE_BADGES,
      singleoptimal: TUTORIAL_SINGLE_BADGES,
      multioptimal: TUTORIAL_MULTI_OPTIMAL_BADGES,
    };

    function tutorialBadgeSpec() {
      return (isTutorialMode() && TUTORIAL_BADGES[studyCondition()]) || [];
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
        const badge = document.createElement("span");
        badge.className = [
          "tutorial-badge",
          `tutorial-badge-${item.place || "above"}`,
          item.muted ? "tutorial-badge-muted" : "",
          label.length > 1 ? "tutorial-badge-pair" : "",
        ].filter(Boolean).join(" ");
        badge.textContent = label;
        if (item.title) badge.title = item.title;
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
