(function () {
  const supportedLanguages =
    "latin,nonlatin,am,ar,az,be,bg,bn,br,bs,ca,co,cs,cy,da,de,el,en,eo,es,et,eu,fa,fi,fr,fy,ga,gd,he,hi,hr,hu,hy,id,is,it,ja,ja-Hira,ja-Latn,ja_kana,ja_rm,ka,kk,kn,ko,ko-Latn,ku,la,lb,lt,lv,mk,ml,mt,nl,no,oc,pa,pl,pnb,pt,rm,ro,ru,sk,sl,sq,sr,sr-Latn,sv,ta,te,th,tr,uk,vi,zh,zh-Hans,zh-Hant".split(
      ","
    );

  const ALT_LOCALES = {
    'zh-cn': 'zh-Hans',
    'zh-hk': 'zh-Hant',
    'zh-mo': 'zh-Hant',
    'zh-sg': 'zh-Hans',
    'zh-tw': 'zh-Hant'
  };

  function checkNamePattern(str, localized) {
    const regex = localized ? /\{name:\S+\}/ : /\{name\}/;

    return {
      contains: regex.test(str),
      exactMatch: new RegExp(`^${regex.source}$`).test(str),
    };
  }

  function isGetNameLanguage(subExpr, localized) {
    return (
      Array.isArray(subExpr) &&
      subExpr.length === 2 &&
      subExpr[0] === "get" &&
      typeof subExpr[1] === "string" &&
      (!localized || subExpr[1].startsWith("name:")) &&
      (localized || subExpr[1] === "name")
    );
  }

  function changeFirstLanguage(origExpr, replacer, localized) {
    const expr = structuredClone(origExpr);

    const exploreNode = (subExpr) => {
      if (typeof subExpr === "string") {
        return;
      }

      for (let i = 0; i < subExpr.length; i += 1) {
        if (isGetNameLanguage(subExpr[i], localized)) {
          subExpr[i] = structuredClone(replacer);
        } else {
          exploreNode(subExpr[i]);
        }
      }
    };

    // The provided expression could be directly a ["get", "name:xx"]
    if (isGetNameLanguage(expr, localized)) {
      return replacer;
    }

    exploreNode(expr);

    return expr;
  }

  function isGetNameLanguageAndFind(subExpr) {
    return (
      // Not language expression
      !Array.isArray(subExpr) ||
        subExpr.length !== 2 ||
        subExpr[0] !== "get" ||
        typeof subExpr[1] !== "string"
        ? null
        : // Is non localized language
        subExpr[1].trim() === "name"
        ? {
            isLanguage: true,
            localization: null,
          }
        : // Is a localized language
        subExpr[1].trim().startsWith("name:")
        ? {
            isLanguage: true,
            localization: subExpr[1].trim().split(":").pop(),
          }
        : null
    );
  }

  function findLanguageObj(origExpr) {
    const languageUsed = [];

    const expr = structuredClone(origExpr);

    const exploreNode = (subExpr) => {
      if (typeof subExpr === "string") {
        return;
      }

      for (let i = 0; i < subExpr.length; i += 1) {
        const result = isGetNameLanguageAndFind(subExpr[i]);

        if (result) {
          languageUsed.push(result.localization);
        } else {
          exploreNode(subExpr[i]);
        }
      }
    };

    exploreNode([expr]);

    return languageUsed;
  }

  function findLanguageStr(str) {
    const regex = /\{name(?:\:(?<language>\S+))?\}/g;

    const languageUsed = [];

    for (;;) {
      const match = regex.exec(str);

      if (!match) {
        break;
      }

      // The is a match
      const language = match.groups?.language ?? null;

      // The language is non-null if provided {name:xx}
      // but if provided {name} then language will be null
      languageUsed.push(language);
    }

    return languageUsed;
  }

  function computeLabelsLocalizationMetrics(layers, map) {
    const languages = [];

    for (const genericLayer of layers) {
      // Only symbole layer can have a layout with text-field
      if (genericLayer.type !== "symbol") {
        continue;
      }

      const layer = genericLayer;

      const { id, layout } = layer;

      if (!layout) {
        continue;
      }

      if (!("text-field" in layout)) {
        continue;
      }

      const textFieldLayoutProp = map.getLayoutProperty(id, "text-field");

      if (!textFieldLayoutProp) {
        continue;
      }

      if (typeof textFieldLayoutProp === "string") {
        languages.push(findLanguageStr(textFieldLayoutProp));
      } else {
        languages.push(findLanguageObj(textFieldLayoutProp));
      }
    }

    const flatLanguages = languages.flat();

    const localizationMetrics = {
      unlocalized: 0,
      localized: {},
    };

    for (const lang of flatLanguages) {
      if (lang === null) {
        localizationMetrics.unlocalized += 1;
      } else {
        if (!(lang in localizationMetrics.localized)) {
          localizationMetrics.localized[lang] = 0;
        }

        localizationMetrics.localized[lang] += 1;
      }
    }

    return localizationMetrics;
  }

  function getBrowserLanguage() {
    if (typeof navigator === "undefined") {
      const fullLocale = Intl.DateTimeFormat().resolvedOptions().locale;
      const lang = fullLocale.split("-")[0];

      if (supportedLanguages.includes(fullLocale)) return "name:" + fullLocale;
      return supportedLanguages.includes(lang) ? "name:" + lang : "name:en";
    }

    const allLocales = navigator.languages.flatMap(lang => {
      let result = [];
      while (lang.includes("-")) {
        result.push(ALT_LOCALES[lang.toLowerCase()] || lang);
        lang = lang.substring(0, lang.lastIndexOf("-"));
      }
      result.push(lang);
      return result.filter(lang => supportedLanguages.includes(lang));
    });

    const candidateLangs = Array.from(new Set(allLocales));
    return candidateLangs[0] ? "name:" + candidateLangs[0] : "name";
  }

  maplibregl.Map.prototype.supportedLanguages = supportedLanguages;

  maplibregl.Map.prototype.getStyleLanguage = function getStyleLanguage() {
    return !this.style ||
      !this.style.stylesheet ||
      !this.style.stylesheet.metadata
      ? null
      : typeof this.style.stylesheet.metadata !== "object"
      ? null
      : "maptiler:language" in this.style.stylesheet.metadata &&
        typeof this.style.stylesheet.metadata["maptiler:language"] === "string"
      ? this.style.stylesheet.metadata["maptiler:language"]
      : null;
  };

  maplibregl.Map.prototype.onStyleReady = function onStyleReady(cb) {
    if (this.isStyleLoaded()) {
      cb();
    } else {
      this.once("styledata", () => {
        cb();
      });
    }
  };

  maplibregl.Map.prototype.setLanguage = function setLanguage(language) {
    this.onStyleReady(() => {
      this.setPrimaryLanguage(language);
    });
  };

  maplibregl.Map.prototype;

  maplibregl.Map.prototype.setPrimaryLanguage = function setPrimaryLanguage(
    lang
  ) {
    const isSpecial = [
      "name",
      "auto",
      "style",
      "visitor",
      "visitor_en",
    ].includes(lang);

    if (!isSpecial && !supportedLanguages.includes(lang)) {
      console.warn(`The language "${lang}" is not supported.`);

      return;
    }

    const language = isSpecial ? lang : "name:" + lang;

    const styleLanguage = this.getStyleLanguage();

    // If the language is set to `STYLE` (which is the SDK default), but the language defined in
    // the style is `auto`, we need to bypass some verification and modify the languages anyway
    if (
      !(
        language === "style" &&
        (styleLanguage === "auto" || styleLanguage === "visitor")
      )
    ) {
      if (language !== "style") {
        this.languageAlwaysBeenStyle = false;
      }

      if (this.languageAlwaysBeenStyle) {
        return;
      }

      // No need to change the language
      if (this.primaryLanguage === language && !this.forceLanguageUpdate) {
        return;
      }
    }

    if (this.primaryLanguage === "style_lock") {
      console.warn(
        "The language cannot be changed because this map has been instantiated with the STYLE_LOCK language flag."
      );

      return;
    }

    this.primaryLanguage = language;

    let languageNonStyle = language;

    // STYLE needs to be translated into one of the other language,
    // this is why it's addressed first
    if (language === "style") {
      if (!styleLanguage) {
        console.warn(
          "The style has no default languages or has an invalid one."
        );

        return;
      }

      languageNonStyle = styleLanguage;
    }

    // may be overwritten below
    let langStr = "name";

    // will be overwritten below
    let replacer = ["get", langStr];

    if (languageNonStyle === "visitor") {
      langStr = getBrowserLanguage();

      replacer = [
        "case",
        ["all", ["has", langStr], ["has", "name"]],
        [
          "case",
          ["==", ["get", langStr], ["get", "name"]],
          ["get", "name"],

          [
            "format",
            ["get", langStr],
            { "font-scale": 0.8 },
            "\n",
            ["get", "name"],
            { "font-scale": 1.1 },
          ],
        ],
        ["get", "name"],
      ];
    } else if (languageNonStyle === "visitor_en") {
      langStr = "name:en";

      replacer = [
        "case",
        ["all", ["has", langStr], ["has", "name"]],
        [
          "case",
          ["==", ["get", langStr], ["get", "name"]],
          ["get", "name"],

          [
            "format",
            ["get", langStr],
            { "font-scale": 0.8 },
            "\n",
            ["get", "name"],
            { "font-scale": 1.1 },
          ],
        ],
        ["get", "name"],
      ];
    } else if (languageNonStyle === "auto") {
      langStr = getBrowserLanguage();

      replacer = ["coalesce", ["get", langStr], ["get", "name"]];
    }

    // This is for using the regular names as {name}
    else if (languageNonStyle === "name") {
      langStr = "name";

      replacer = ["get", langStr];
    }

    // This section is for the regular language ISO codes
    else {
      langStr = languageNonStyle;

      replacer = ["coalesce", ["get", langStr], ["get", "name"]];
    }

    const { layers } = this.getStyle();

    this.originalLabelStyle ??= new Map();

    // True if it's the first time the language is updated for the current style
    const firstPassOnStyle = this.originalLabelStyle.size === 0;

    // Analisis on all the label layers to check the languages being used
    if (firstPassOnStyle) {
      const labelsLocalizationMetrics = computeLabelsLocalizationMetrics(
        layers,
        this
      );

      this.isStyleLocalized =
        Object.keys(labelsLocalizationMetrics.localized).length > 0;
    }

    for (const layer of layers) {
      // Only symbole layer can have a layout with text-field
      if (layer.type !== "symbol") {
        continue;
      }

      const source = this.getSource(layer.source);

      // Only a layer that is bound to a valid source is considered for language switching
      if (!source) {
        continue;
      }

      // Only source with a url are considered
      if (!("url" in source && typeof source.url === "string")) {
        continue;
      }

      const sourceURL = new URL(source.url);

      // Only layers managed by MapTiler are considered for language switch
      if (sourceURL.host !== "api.maptiler.com") {
        continue;
      }

      const { id, layout } = layer;

      if (!layout || !("text-field" in layout)) {
        continue;
      }

      let textFieldLayoutProp;

      // Keeping a copy of the text-field sub-object as it is in the original style
      if (firstPassOnStyle) {
        textFieldLayoutProp = this.getLayoutProperty(id, "text-field");
        this.originalLabelStyle.set(id, textFieldLayoutProp);
      } else {
        textFieldLayoutProp = this.originalLabelStyle.get(id);
      }

      // From this point, the value of textFieldLayoutProp is as in the original version of the style
      // and never a mofified version

      // Testing the different case where the text-field property should NOT be updated:
      if (typeof textFieldLayoutProp === "string") {
        // When the original style is localized (this.isStyleLocalized is true), we do not modify the {name} because they are
        // very likely to be only fallbacks.
        // When the original style is not localized (this.isStyleLocalized is false), the occurences of "{name}"
        // should be replaced by localized versions with fallback to local language.

        const { contains, exactMatch } = checkNamePattern(
          textFieldLayoutProp,
          this.isStyleLocalized
        );

        // If the current text-fiels does not contain any "{name:xx}" pattern
        if (!contains) {
          continue;
        }

        // In case of an exact match, we replace by an object representation of the label
        if (exactMatch) {
          this.setLayoutProperty(id, "text-field", replacer);
        } else {
          // In case of a non-exact match (such as "foo {name:xx} bar" or "foo {name} bar", depending on localization)
          // we create a "concat" object expresion composed of the original elements with new replacer
          // in-betweem
          this.setLayoutProperty(
            id,
            "text-field",
            replaceLanguage(
              textFieldLayoutProp,
              replacer,
              this.isStyleLocalized
            )
          );
        }
      }

      // The value of text-field is an object
      else {
        this.setLayoutProperty(
          id,
          "text-field",
          changeFirstLanguage(
            textFieldLayoutProp,
            replacer,
            this.isStyleLocalized
          )
        );
      }
    }
  };
})();
