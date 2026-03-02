/**
 * slackoff.js
 *
 * Privacy feature for the WriteFreely pad editor.
 *
 * When enabled, the actual textarea content is rendered transparently while a
 * mirror <div> underneath shows the content mixed with non-selectable lorem
 * ipsum filler words. Colleagues reading the screen from a distance see a
 * dense, confusing wall of text; the author can still type, read, select and
 * copy their real content normally.
 *
 * Public API (window.SlackOff):
 *   init(writerId, isNewPost)  – call once after DOM is ready
 *   enable()                   – turn feature on
 *   disable()                  – turn feature off
 *   toggle()                   – flip current state
 *   setLanguage(lang)          – change filler language ('en', 'zh', …)
 *
 * Adding a new language:
 *   1. Add an entry to LOREM_BANKS below.
 *   2. Add a <li class="slackoff-lang" id="slackoff-lang-XX"> item in pad.tmpl.
 *   No other changes required.
 */
(function () {
  'use strict';

  /* -------------------------------------------------------------------------
   * Language banks
   * English: classic Lorem Ipsum word list.
   * Chinese: 200+ high-frequency single characters – concatenated without
   *          spaces to produce authentic-looking Chinese runs.
   * ------------------------------------------------------------------------- */
  var LOREM_BANKS = {
    en: [
      'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
      'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore',
      'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam',
      'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi',
      'aliquip', 'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure',
      'reprehenderit', 'voluptate', 'velit', 'esse', 'cillum', 'fugiat',
      'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat', 'cupidatat',
      'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt',
      'mollit', 'anim', 'id', 'est', 'laborum', 'perspiciatis', 'unde',
      'omnis', 'iste', 'natus', 'error', 'voluptatem', 'accusantium',
      'doloremque', 'laudantium', 'totam', 'rem', 'aperiam', 'eaque', 'ipsa',
      'quae', 'ab', 'illo', 'inventore', 'veritatis', 'quasi', 'architecto',
      'beatae', 'vitae', 'dicta', 'sunt', 'explicabo', 'nemo', 'ipsam'
    ],
    zh: [
      '的', '一', '是', '在', '不', '了', '有', '和', '人', '这', '中', '大',
      '为', '上', '个', '国', '我', '以', '要', '他', '时', '来', '用', '们',
      '生', '到', '作', '地', '于', '出', '就', '分', '对', '成', '会', '可',
      '主', '发', '年', '动', '同', '工', '也', '能', '下', '过', '子', '说',
      '产', '种', '面', '而', '方', '后', '多', '定', '行', '学', '法', '所',
      '民', '得', '经', '十', '三', '之', '进', '着', '等', '部', '度', '家',
      '电', '力', '里', '如', '水', '化', '高', '自', '二', '理', '起', '小',
      '物', '现', '实', '加', '量', '都', '两', '体', '制', '机', '当', '使',
      '点', '从', '业', '本', '去', '把', '性', '好', '应', '开', '它', '合',
      '还', '因', '由', '其', '些', '然', '前', '外', '天', '政', '四', '日',
      '那', '社', '义', '事', '平', '形', '相', '全', '表', '间', '样', '与',
      '关', '各', '重', '新', '线', '内', '数', '正', '心', '反', '你', '明',
      '看', '原', '又', '么', '利', '比', '或', '但', '质', '气', '第', '向',
      '道', '命', '此', '变', '条', '只', '没', '结', '解', '问', '意', '建',
      '月', '公', '无', '系', '军', '很', '情', '者', '河', '村', '八', '难',
      '早', '论', '吗', '根', '共', '让', '信', '觉', '步', '处', '记', '将',
      '千', '位', '活', '广', '走', '极', '门', '据', '则', '格', '期', '市',
      '长', '环', '海', '春', '总', '华', '带', '路', '风', '光', '名', '字',
      '北', '南', '东', '西', '左', '右', '手', '头', '眼', '心', '口', '耳'
    ]
  };

  /* Prefill placeholder text shown on an empty new post when feature is first
   * enabled, helping the user understand how the feature looks. */
  var PLACEHOLDER_TEXT = {
    en: 'Start writing your post here...',
    zh: '在这里开始写你的文章……'
  };

  /* localStorage keys */
  var KEY_ENABLED  = 'slackOffEnabled';
  var KEY_LANGUAGE = 'slackOffLanguage';
  var KEY_OPACITY  = 'slackOffOpacity';

  /* Mutable feature state */
  var state = {
    enabled:   false,
    language:  'en',
    isNewPost: false,
    opacity:   0.6
  };

  /* Cached DOM references (populated in init) */
  var els = {
    writer: null,  // the textarea element
    mirror: null   // the mirror div element
  };

  /* Per-render caches — cleared when font, language, or viewport changes. */
  var _soMeasurer    = null;  // hidden <span> for DOM-based text measurement
  var _soWordWidths  = {};    // key: lang+'\0'+sep+word → px width (cached)
  var _soAvailWidth  = -1;    // mirror content width in px (-1 = needs measure)
  var _soFillerCache = {};    // key: lang+'\0'+lineContent → filler string

  /* -------------------------------------------------------------------------
   * Filler generation — DOM-measured, per-line cached
   * ------------------------------------------------------------------------- */

  function randomWord(bank) {
    return bank[Math.floor(Math.random() * bank.length)];
  }

  /**
   * Ensures the hidden measurer <span> exists in the document body.
   * The element is positioned off-screen and is invisible and non-interactive.
   */
  function ensureMeasurer() {
    if (_soMeasurer && _soMeasurer.parentNode) return;
    _soMeasurer = document.createElement('span');
    _soMeasurer.setAttribute('aria-hidden', 'true');
    _soMeasurer.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;white-space:pre;' +
      'visibility:hidden;pointer-events:none';
    document.body.appendChild(_soMeasurer);
  }

  /**
   * Copies the mirror div's computed font properties to the measurer span so
   * that getBoundingClientRect measurements match rendered text exactly,
   * including letter-spacing which canvas measureText ignores.
   */
  function syncMeasurerFont() {
    ensureMeasurer();
    var s = window.getComputedStyle(els.mirror);
    _soMeasurer.style.fontFamily    = s.fontFamily;
    _soMeasurer.style.fontSize      = s.fontSize;
    _soMeasurer.style.fontWeight    = s.fontWeight;
    _soMeasurer.style.fontStyle     = s.fontStyle;
    _soMeasurer.style.letterSpacing = s.letterSpacing;
  }

  /** Returns the rendered pixel width of an arbitrary text string. */
  function measureLinePx(text) {
    _soMeasurer.textContent = text;
    return _soMeasurer.getBoundingClientRect().width;
  }

  /**
   * Returns the pixel width of sep+word, using a per-word cache to avoid
   * repeated DOM queries for the same word during a single render pass.
   */
  function getWordWidth(word, sep) {
    var key = state.language + '\x00' + sep + word;
    if (_soWordWidths[key] === undefined) {
      _soMeasurer.textContent = sep + word;
      _soWordWidths[key] = _soMeasurer.getBoundingClientRect().width;
    }
    return _soWordWidths[key];
  }

  /**
   * Returns the usable content width of the mirror div in pixels, i.e. its
   * clientWidth minus horizontal padding. Cached until invalidated.
   */
  function getContentWidth() {
    if (_soAvailWidth > 0) return _soAvailWidth;
    if (!els.mirror) return 600;
    var s = window.getComputedStyle(els.mirror);
    _soAvailWidth = els.mirror.clientWidth
      - (parseFloat(s.paddingLeft)  || 0)
      - (parseFloat(s.paddingRight) || 0);
    return _soAvailWidth;
  }

  /**
   * Builds (or retrieves from cache) the filler string for one line.
   * Returns '' for empty lines or lines that already fill the available width.
   * The result is pixel-fitted: words are added until the next word would
   * overflow the remaining space, so no filler wraps onto the next visual row.
   */
  function buildFiller(line) {
    /* 1. No filler on empty lines. */
    if (!line.trim()) return '';

    /* 2. Return stable cached filler so unedited lines don't change. */
    var cacheKey = state.language + '\x00' + line;
    if (_soFillerCache[cacheKey] !== undefined) return _soFillerCache[cacheKey];

    var bank      = LOREM_BANKS[state.language] || LOREM_BANKS['en'];
    var isZh      = (state.language === 'zh');
    var sep       = isZh ? '' : ' ';
    /* 3. Measure how many words fit without overflowing the line.
     *    A 4 px safety buffer absorbs subpixel rounding differences. */
    var remaining = getContentWidth() - measureLinePx(line) - 4;

    if (remaining <= 0) {
      _soFillerCache[cacheKey] = '';
      return '';
    }

    var words  = [];
    var filled = 0;
    for (var i = 0; i < 80; i++) {
      var w  = randomWord(bank);
      var px = getWordWidth(w, sep);
      if (filled + px > remaining) break;
      words.push(w);
      filled += px;
    }

    var result = words.length > 0 ? (sep + words.join(sep)) : '';
    _soFillerCache[cacheKey] = result;
    return result;
  }

  /** Clears all measurement and filler caches (call on font/language/resize). */
  function invalidateCaches() {
    _soWordWidths  = {};
    _soAvailWidth  = -1;
    _soFillerCache = {};
  }

  /* -------------------------------------------------------------------------
   * Mirror rendering
   * ------------------------------------------------------------------------- */

  /**
   * Re-renders the mirror div from the current textarea value.
   * Each hard-break line of actual content is followed by a span of filler
   * text so that:
   *   - The author (up close) sees their real text at the start of each line.
   *   - An observer (from afar) sees densely packed, indistinguishable text.
   */
  function renderMirror(content) {
    var mirror = els.mirror;
    if (!mirror) return;

    /* Sync font class so mirror matches the textarea's current typeface. */
    mirror.className = 'so-mirror ' + (els.writer.className || '');

    /* Sync the DOM measurer's font so measurements match the mirror's typeface. */
    syncMeasurerFont();

    /* Clear previous children efficiently. */
    while (mirror.firstChild) {
      mirror.removeChild(mirror.firstChild);
    }

    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      /* Actual content span */
      var actualSpan = document.createElement('span');
      actualSpan.className = 'so-actual';
      actualSpan.textContent = lines[i];
      mirror.appendChild(actualSpan);

      /* Filler span — pixel-fitted and cached so:
       *   • empty lines get no filler,
       *   • unedited lines keep stable filler,
       *   • filler never wraps onto the next visual row. */
      var filler = buildFiller(lines[i]);
      if (filler) {
        var fillerSpan = document.createElement('span');
        fillerSpan.className = 'so-filler';
        fillerSpan.textContent = filler;
        mirror.appendChild(fillerSpan);
      }

      /* Hard line break (skip after final line to avoid trailing blank line). */
      if (i < lines.length - 1) {
        mirror.appendChild(document.createElement('br'));
      }
    }
  }

  /**
   * Syncs mirror content and scroll position from the textarea.
   */
  function syncMirror() {
    if (!state.enabled || !els.mirror) return;
    renderMirror(els.writer.value);
    els.mirror.scrollTop = els.writer.scrollTop;
  }

  /* -------------------------------------------------------------------------
   * Enable / disable
   * ------------------------------------------------------------------------- */

  function updateIcon() {
    var icon = document.getElementById('slackoff-icon');
    if (icon) {
      icon.textContent = state.enabled ? 'blur_on' : 'blur_off';
      if (state.enabled) {
        icon.classList.add('so-active');
      } else {
        icon.classList.remove('so-active');
      }
    }
    var checkbox = document.getElementById('slackoff-enabled');
    if (checkbox) {
      checkbox.checked = state.enabled;
    }
  }

  function enable() {
    state.enabled = true;
    document.body.classList.add('slack-off-active');
    els.writer.classList.add('so-writer');
    els.mirror.style.display = 'block';

    /* Prefill an empty new-post textarea so the user can see the effect. */
    if (state.isNewPost && !els.writer.value.trim()) {
      var placeholder = PLACEHOLDER_TEXT[state.language] || PLACEHOLDER_TEXT['en'];
      els.writer.value = placeholder;
    }

    syncMirror();
    updateIcon();
    H.set(KEY_ENABLED, 'true');
  }

  function disable() {
    state.enabled = false;
    document.body.classList.remove('slack-off-active');
    els.writer.classList.remove('so-writer');
    els.mirror.style.display = 'none';
    updateIcon();
    H.set(KEY_ENABLED, 'false');
  }

  function toggle() {
    if (state.enabled) { disable(); } else { enable(); }
  }

  /* -------------------------------------------------------------------------
   * Language switching
   * ------------------------------------------------------------------------- */

  function setLanguage(lang) {
    if (!LOREM_BANKS[lang]) return;
    state.language = lang;
    _soFillerCache = {};
    H.set(KEY_LANGUAGE, lang);

    /* Update selected state in the language menu. */
    var items = document.querySelectorAll('.slackoff-lang');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.remove('selected');
    }
    var active = document.getElementById('slackoff-lang-' + lang);
    if (active) active.classList.add('selected');

    if (state.enabled) syncMirror();
  }

  /* -------------------------------------------------------------------------
   * Opacity control
   * ------------------------------------------------------------------------- */

  /**
   * Sets the mirror's opacity and persists it.
   * @param {number|string} val  0.1 – 1.0 (values are clamped to this range)
   */
  function setOpacity(val) {
    var n = parseFloat(val);
    if (isNaN(n)) return;
    n = Math.min(1, Math.max(0.1, n));
    state.opacity = n;
    if (els.mirror) els.mirror.style.setProperty('--so-filler-opacity', n);
    H.set(KEY_OPACITY, String(n));

    /* Keep the slider thumb and label in sync regardless of who called this. */
    var slider = document.getElementById('slackoff-opacity');
    if (slider) slider.value = n;
    var label = document.getElementById('slackoff-opacity-val');
    if (label) label.textContent = Math.round(n * 100) + '%';
  }

  /* -------------------------------------------------------------------------
   * Initialisation
   * ------------------------------------------------------------------------- */

  /**
   * Creates the mirror div, wires all event listeners, and restores any
   * previously saved state from localStorage.
   *
   * @param {string}  writerId   ID of the textarea element (e.g. 'writer')
   * @param {boolean} isNewPost  True when creating a new post (enables prefill)
   */
  function init(writerId, isNewPost) {
    var writer = document.getElementById(writerId);
    if (!writer) return;

    els.writer    = writer;
    state.isNewPost = !!isNewPost;

    /* Create the mirror div and insert it directly before the textarea in the
     * DOM. Fixed elements stack by DOM order, so the mirror sits beneath the
     * textarea without needing explicit z-index on either element. */
    var mirror = document.createElement('div');
    mirror.id = 'slack-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.display = 'none';
    writer.parentNode.insertBefore(mirror, writer);
    els.mirror = mirror;

    /* Restore saved settings. */
    var savedLang = H.get(KEY_LANGUAGE, 'en');
    state.language = LOREM_BANKS[savedLang] ? savedLang : 'en';

    /* Reflect the saved language in the menu (selected class). */
    setLanguage(state.language);

    /* Restore saved opacity (applies immediately so the mirror is correct
     * if auto-enable fires below). */
    setOpacity(parseFloat(H.get(KEY_OPACITY, '0.6')));

    /* Wire the opacity slider. */
    var opacitySlider = document.getElementById('slackoff-opacity');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', function () {
        setOpacity(this.value);
      });
    }

    /* Wire textarea events. */
    writer.addEventListener('input', function () {
      if (state.enabled) syncMirror();
    });
    writer.addEventListener('scroll', function () {
      if (state.enabled && els.mirror) {
        els.mirror.scrollTop = writer.scrollTop;
      }
    });

    /* Watch for font-class changes on the textarea (user changes typeface) and
     * propagate them to the mirror so rendering stays consistent. */
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function () {
        if (state.enabled) {
          /* Font changed — cached measurements and filler are stale. */
          invalidateCaches();
          syncMirror();
        }
      });
      observer.observe(writer, { attributes: true, attributeFilter: ['class'] });
    }

    /* Viewport resize changes available width and responsive padding. */
    window.addEventListener('resize', function () {
      invalidateCaches();
      if (state.enabled) syncMirror();
    });

    /* Wire the Enable / Disable checkbox. */
    var checkbox = document.getElementById('slackoff-enabled');
    if (checkbox) {
      checkbox.addEventListener('change', function () {
        if (this.checked) { enable(); } else { disable(); }
      });
    }

    /* Wire language selector items. */
    var langItems = document.querySelectorAll('.slackoff-lang a');
    for (var i = 0; i < langItems.length; i++) {
      langItems[i].addEventListener('click', function (e) {
        e.preventDefault();
        /* Extract language code from href fragment: #slackoff-en → 'en' */
        var href  = this.href || this.getAttribute('href');
        var parts = href.split('#slackoff-');
        if (parts.length > 1) {
          setLanguage(parts[1]);
        }
      });
    }

    /* Wire the Prefill button (only present on new-post pages). */
    var prefillBtn = document.getElementById('slackoff-prefill');
    if (prefillBtn) {
      prefillBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var placeholder = PLACEHOLDER_TEXT[state.language] || PLACEHOLDER_TEXT['en'];
        writer.value = placeholder;
        if (state.enabled) syncMirror();
      });
    }

    /* Auto-restore enabled state from the previous session. */
    if (H.get(KEY_ENABLED, 'false') === 'true') {
      enable();
    } else {
      updateIcon();
    }
  }

  /* -------------------------------------------------------------------------
   * Public API
   * ------------------------------------------------------------------------- */
  window.SlackOff = {
    init:        init,
    enable:      enable,
    disable:     disable,
    toggle:      toggle,
    setLanguage: setLanguage,
    setOpacity:  setOpacity
  };

}());
