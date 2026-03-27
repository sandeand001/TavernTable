// LightingSystem.js — Sun cycle, color math, time-of-day profiles, terrain/placeable lighting.
// Extracted from ThreeSceneManager.js (Phase 6). Installed via mixin pattern.

function _normalizeMinutes(mins) {
  if (!Number.isFinite(mins)) return 0;
  let value = mins % 1440;
  if (value < 0) value += 1440;
  return value;
}

function _minutesToAzimuthDegrees(mins) {
  const normalized = this._normalizeMinutes(mins);
  const base = (normalized / 1440) * 360;
  const offset = Number.isFinite(this._sunAzimuthOffsetDeg) ? this._sunAzimuthOffsetDeg : 0;
  return this._normalizeDegrees(base + offset);
}

function _azimuthDegreesToMinutes(degrees) {
  const offset = Number.isFinite(this._sunAzimuthOffsetDeg) ? this._sunAzimuthOffsetDeg : 0;
  const normalized = this._normalizeDegrees(degrees - offset);
  const minutes = (normalized / 360) * 1440;
  return this._normalizeMinutes(minutes);
}

function _applySunElevationForTime(minutes, options = {}) {
  const normalized = this._normalizeMinutes(minutes);
  const span = Math.max(0, (this._sunMaxElevation ?? 14) - (this._sunMinElevation ?? 6));
  const minElev = Number.isFinite(this._sunMinElevation) ? this._sunMinElevation : 6;
  const phase = (normalized / 1440) * 2 * Math.PI;
  const daylight = Math.max(0, Math.sin(phase - Math.PI / 2));
  const targetY = minElev + span * daylight;
  if (Number.isFinite(targetY)) {
    this._sunOffset.y = targetY;
    if (!options.deferSunCoverage) {
      this._updateSunCoverage();
    }
  }
}

function _applyStoredSunTime() {
  let pendingMinutes = null;
  let fallbackDegrees = null;
  try {
    if (typeof window !== 'undefined') {
      if (Number.isFinite(window.__TT_PENDING_SUN_TIME_MINUTES)) {
        pendingMinutes = window.__TT_PENDING_SUN_TIME_MINUTES;
      } else if (Number.isFinite(window.__TT_PENDING_SUN_AZIMUTH_DEG)) {
        fallbackDegrees = window.__TT_PENDING_SUN_AZIMUTH_DEG;
      }
    }
  } catch (_) {
    /* ignore */
  }

  if (Number.isFinite(pendingMinutes)) {
    this.setSunTimeMinutes(pendingMinutes, { immediate: true, skipPersist: true });
    return;
  }

  if (Number.isFinite(fallbackDegrees)) {
    const derivedMinutes = this._azimuthDegreesToMinutes(fallbackDegrees);
    this.setSunTimeMinutes(derivedMinutes, { immediate: true, skipPersist: true });
    return;
  }

  this.setSunTimeMinutes(this._sunTimeMinutes ?? 720, { immediate: true, skipPersist: true });
}

function _ensureSunAnimator() {
  if (this._sunAnimFn) return;
  this._sunAnimFn = (ts) => {
    if (!this._sunAnimActive) return;
    const lastTs = this._sunLastAnimTs != null ? this._sunLastAnimTs : ts;
    const elapsed = Math.max(0, ts - lastTs);
    this._sunLastAnimTs = ts;
    const current = this._sunAzimuthRad;
    const target = this._targetSunAzimuthRad;
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    if (Math.abs(delta) < 0.0004) {
      this._sunAzimuthRad = target;
      this._sunAnimActive = false;
      this._applySunAzimuth();
      return;
    }
    const tau = this._sunLerpTauMs || 220;
    const alpha = 1 - Math.exp(-elapsed / Math.max(1, tau));
    this._sunAzimuthRad = current + delta * Math.min(1, Math.max(0, alpha));
    this._applySunAzimuth();
  };
  this._animCallbacks.push(this._sunAnimFn);
}

function _applySunAzimuth() {
  if (!Number.isFinite(this._sunRadius) || this._sunRadius <= 0) {
    this._sunRadius = Math.hypot(this._sunOffset.x, this._sunOffset.z) || 1;
  }
  const radius = this._sunRadius;
  const x = Math.cos(this._sunAzimuthRad) * radius;
  const z = Math.sin(this._sunAzimuthRad) * radius;
  if (Number.isFinite(x) && Number.isFinite(z)) {
    this._sunOffset.x = x;
    this._sunOffset.z = z;
  }
  this._updateSunCoverage();
}

function setSunAzimuthDegrees(degrees, options = {}) {
  if (!Number.isFinite(degrees)) return;
  const normalized = this._normalizeDegrees(degrees);
  const rad = (normalized * Math.PI) / 180;
  this._targetSunAzimuthRad = rad;
  if (!Number.isFinite(this._sunRadius) || this._sunRadius <= 0) {
    this._sunRadius = Math.hypot(this._sunOffset.x, this._sunOffset.z) || 1;
  }
  if (!options.skipTimeSync) {
    const derivedMinutes = this._azimuthDegreesToMinutes(normalized);
    this._sunTimeMinutes = derivedMinutes;
    this._applySunElevationForTime(derivedMinutes, options);
    try {
      const profile = this.getTimeOfDayProfile(derivedMinutes);
      this._applyTimeOfDayProfile(profile);
    } catch (_) {
      /* ignore profile sync errors */
    }
    if (typeof window !== 'undefined' && !options.skipPersist) {
      window.__TT_PENDING_SUN_TIME_MINUTES = derivedMinutes;
    }
  }
  if (typeof window !== 'undefined' && !options.skipPersist) {
    window.__TT_PENDING_SUN_AZIMUTH_DEG = normalized;
  }
  if (options.immediate || !this._sunLight) {
    this._sunAnimActive = false;
    this._sunAzimuthRad = rad;
    this._sunLastAnimTs = null;
    this._applySunAzimuth();
    return;
  }
  this._sunAnimActive = true;
  this._ensureSunAnimator();
}

function getSunAzimuthDegrees() {
  return this._normalizeDegrees((this._sunAzimuthRad * 180) / Math.PI);
}

function setSunTimeMinutes(minutes, options = {}) {
  if (!Number.isFinite(minutes)) return;
  const normalized = this._normalizeMinutes(minutes);
  this._sunTimeMinutes = normalized;
  if (typeof window !== 'undefined' && !options.skipPersist) {
    window.__TT_PENDING_SUN_TIME_MINUTES = normalized;
  }
  this._applySunElevationForTime(normalized, options);
  const targetDegrees = this._minutesToAzimuthDegrees(normalized);
  this.setSunAzimuthDegrees(targetDegrees, {
    ...options,
    skipPersist: true,
    skipTimeSync: true,
  });
  try {
    const profile = this.getTimeOfDayProfile(normalized);
    this._applyTimeOfDayProfile(profile);
  } catch (_) {
    /* ignore lighting profile errors */
  }
  if (typeof window !== 'undefined' && !options.skipPersist) {
    window.__TT_PENDING_SUN_AZIMUTH_DEG = this.getSunAzimuthDegrees();
  }
}

function getSunTimeMinutes() {
  if (Number.isFinite(this._sunTimeMinutes)) {
    return this._normalizeMinutes(this._sunTimeMinutes);
  }
  const derived = this._azimuthDegreesToMinutes(this.getSunAzimuthDegrees());
  this._sunTimeMinutes = derived;
  return derived;
}

function _normalizeDegrees(deg) {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

function _applyTimeOfDayProfile(profile) {
  if (!profile || typeof profile !== 'object') return;
  this._timeOfDayProfile = profile;
  try {
    this._applyTerrainColorProfile(profile.terrain);
  } catch (_) {
    /* ignore terrain tint errors */
  }
  try {
    this._applyPlaceableLightingProfile(profile.placeables);
  } catch (_) {
    /* ignore placeable tint errors */
  }
  try {
    this._applyLightProfile(profile.lighting);
  } catch (_) {
    /* ignore lighting profile errors */
  }
}

function _clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function _srgbToLinear(component) {
  if (!Number.isFinite(component)) return 0;
  if (component <= 0.04045) return component / 12.92;
  return Math.pow((component + 0.055) / 1.055, 2.4);
}

function _hexToLinearRGB(hex) {
  if (!Number.isFinite(hex)) return { r: 1, g: 1, b: 1 };
  if (!this._colorCacheLinear) this._colorCacheLinear = new Map();
  if (this._colorCacheLinear.has(hex)) {
    const cached = this._colorCacheLinear.get(hex);
    return { r: cached.r, g: cached.g, b: cached.b };
  }
  const r = this._srgbToLinear(((hex >> 16) & 0xff) / 255);
  const g = this._srgbToLinear(((hex >> 8) & 0xff) / 255);
  const b = this._srgbToLinear((hex & 0xff) / 255);
  const base = { r, g, b };
  this._colorCacheLinear.set(hex, base);
  return { r, g, b };
}

function _cloneLinearColor(color) {
  if (!color) return null;
  return { r: color.r, g: color.g, b: color.b };
}

function _mixLinearColor(a, b, t) {
  if (!a || !b) return t >= 1 ? this._cloneLinearColor(b) : this._cloneLinearColor(a);
  const alpha = this._clamp(t, 0, 1);
  const inv = 1 - alpha;
  return {
    r: a.r * inv + b.r * alpha,
    g: a.g * inv + b.g * alpha,
    b: a.b * inv + b.b * alpha,
  };
}

function _smoothstep(edge0, edge1, x) {
  if (!Number.isFinite(edge0) || !Number.isFinite(edge1)) return 0;
  if (edge0 === edge1) return x >= edge1 ? 1 : 0;
  const t = this._clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function _timeWindowFactor(minutes, start, end, fade = 60) {
  if (!Number.isFinite(minutes) || !Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const normalized = this._normalizeMinutes(minutes);
  const s = start;
  let e = end;
  while (e <= s) e += 1440;
  let m = normalized;
  if (m < s) m += 1440;
  if (fade <= 0) {
    return m >= s && m <= e ? 1 : 0;
  }
  const width = Math.max(15, Math.min(fade, (e - s) / 2));
  const rise = this._smoothstep(s, s + width, m);
  const fall = 1 - this._smoothstep(e - width, e, m);
  return this._clamp(Math.min(rise, fall), 0, 1);
}

function getTimeOfDayProfile(minutes = this.getSunTimeMinutes()) {
  const normalized = this._normalizeMinutes(Number.isFinite(minutes) ? minutes : 0);
  const sunriseCore = this._timeWindowFactor(normalized, 315, 450, 75);
  const dawnGlow = this._timeWindowFactor(normalized, 240, 330, 45);
  const sunsetCore = this._timeWindowFactor(normalized, 1050, 1230, 75);
  const duskGlow = this._timeWindowFactor(normalized, 1200, 1320, 60);
  const sunriseBlend = this._clamp(Math.max(sunriseCore, dawnGlow * 0.8), 0, 1);
  const sunsetBlend = this._clamp(Math.max(sunsetCore, duskGlow * 0.7), 0, 1);
  const nightEarly = this._timeWindowFactor(normalized, 0, 240, 60);
  const nightLate = this._timeWindowFactor(normalized, 1260, 1500, 90);
  const nightBlend = this._clamp(Math.max(nightEarly, nightLate, duskGlow * 0.4), 0, 1);
  const dayBlend = this._clamp(1 - Math.max(sunriseBlend, sunsetBlend, nightBlend), 0, 1);
  const daylight = dayBlend;
  const twilight = Math.max(sunriseBlend, sunsetBlend);
  const nightFactor = nightBlend;

  let phase = 'day';
  if (nightFactor > 0.55) phase = 'night';
  else if (sunriseBlend >= sunsetBlend && sunriseBlend > 0.25) phase = 'sunrise';
  else if (sunsetBlend > 0.25) phase = 'sunset';

  const mixScalar = (a, b, t) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return b;
    return a + (b - a) * this._clamp(t, 0, 1);
  };
  const makeTint = (saturation, brightness, warmMix, coolMix, warmColor, coolColor) => ({
    saturation,
    brightness,
    warmMix,
    coolMix,
    warmColor: warmColor ? this._cloneLinearColor(warmColor) : null,
    coolColor: coolColor ? this._cloneLinearColor(coolColor) : null,
  });
  const blendTint = (from, to, weight) => {
    if (!to || !Number.isFinite(weight) || weight <= 0) return from;
    const t = this._clamp(weight, 0, 1);
    return {
      saturation: mixScalar(from.saturation, to.saturation, t),
      brightness: mixScalar(from.brightness, to.brightness, t),
      warmMix: mixScalar(from.warmMix, to.warmMix, t),
      coolMix: mixScalar(from.coolMix, to.coolMix, t),
      warmColor: this._cloneLinearColor(to.warmColor || from.warmColor),
      coolColor: this._cloneLinearColor(to.coolColor || from.coolColor),
    };
  };
  const applyTintLayers = (base, layers) => {
    let current = {
      saturation: base.saturation,
      brightness: base.brightness,
      warmMix: base.warmMix,
      coolMix: base.coolMix,
      warmColor: base.warmColor ? this._cloneLinearColor(base.warmColor) : null,
      coolColor: base.coolColor ? this._cloneLinearColor(base.coolColor) : null,
    };
    for (const layer of layers) {
      if (!layer || !layer.profile) continue;
      current = blendTint(current, layer.profile, layer.weight || 0);
    }
    return current;
  };
  const blendLighting = (from, to, weight) => {
    if (!to || !Number.isFinite(weight) || weight <= 0) return from;
    const t = this._clamp(weight, 0, 1);
    return {
      sunColor: this._mixLinearColor(from.sunColor, to.sunColor, t),
      sunIntensity: mixScalar(from.sunIntensity, to.sunIntensity, t),
      ambientColor: this._mixLinearColor(from.ambientColor, to.ambientColor, t),
      ambientIntensity: mixScalar(from.ambientIntensity, to.ambientIntensity, t),
      hemisphereSkyColor: this._mixLinearColor(from.hemisphereSkyColor, to.hemisphereSkyColor, t),
      hemisphereGroundColor: this._mixLinearColor(
        from.hemisphereGroundColor,
        to.hemisphereGroundColor,
        t
      ),
      hemisphereIntensity: mixScalar(from.hemisphereIntensity, to.hemisphereIntensity, t),
    };
  };
  const applyLightingLayers = (base, layers) => {
    let current = {
      sunColor: this._cloneLinearColor(base.sunColor),
      sunIntensity: base.sunIntensity,
      ambientColor: this._cloneLinearColor(base.ambientColor),
      ambientIntensity: base.ambientIntensity,
      hemisphereSkyColor: this._cloneLinearColor(base.hemisphereSkyColor),
      hemisphereGroundColor: this._cloneLinearColor(base.hemisphereGroundColor),
      hemisphereIntensity: base.hemisphereIntensity,
    };
    for (const layer of layers) {
      if (!layer || !layer.profile) continue;
      current = blendLighting(current, layer.profile, layer.weight || 0);
    }
    return current;
  };

  const terrainWarm = this._hexToLinearRGB(0xf1b973);
  const terrainCool = this._hexToLinearRGB(0x1b2f4f);
  const foliageWarm = this._hexToLinearRGB(0xffb86c);
  const foliageCool = this._hexToLinearRGB(0x123155);
  const structureWarm = this._hexToLinearRGB(0xf0c091);
  const structureCool = this._hexToLinearRGB(0x1f273b);
  const pathWarm = this._hexToLinearRGB(0xe2a677);
  const pathCool = this._hexToLinearRGB(0x252c39);

  const terrainBase = makeTint(1, 1, 0, 0, terrainWarm, terrainCool);
  const terrainSunrise = makeTint(1.05, 1.06, 0.42, 0.05, terrainWarm, terrainCool);
  const terrainSunset = makeTint(1.0, 0.98, 0.45, 0.08, terrainWarm, terrainCool);
  const terrainNight = makeTint(0.9, 0.75, 0.05, 0.52, terrainWarm, terrainCool);

  const plantBase = makeTint(1, 1, 0, 0, foliageWarm, foliageCool);
  const plantSunrise = makeTint(1.08, 1.08, 0.6, 0.08, foliageWarm, foliageCool);
  const plantSunset = makeTint(1.02, 1.0, 0.55, 0.12, foliageWarm, foliageCool);
  const plantNight = makeTint(0.82, 0.76, 0.05, 0.6, foliageWarm, foliageCool);

  const structureBase = makeTint(1, 1, 0, 0, structureWarm, structureCool);
  const structureSunrise = makeTint(1.02, 1.03, 0.36, 0.05, structureWarm, structureCool);
  const structureSunset = makeTint(1.0, 0.97, 0.32, 0.08, structureWarm, structureCool);
  const structureNight = makeTint(0.9, 0.78, 0.04, 0.32, structureWarm, structureCool);

  const pathBase = makeTint(1, 1, 0, 0, pathWarm, pathCool);
  const pathSunrise = makeTint(1.03, 1.02, 0.34, 0.04, pathWarm, pathCool);
  const pathSunset = makeTint(1.0, 0.97, 0.38, 0.08, pathWarm, pathCool);
  const pathNight = makeTint(0.92, 0.78, 0.04, 0.36, pathWarm, pathCool);

  const terrainProfile = applyTintLayers(terrainBase, [
    { profile: terrainSunrise, weight: sunriseBlend },
    { profile: terrainSunset, weight: sunsetBlend },
    { profile: terrainNight, weight: nightBlend },
  ]);

  const plantProfile = applyTintLayers(plantBase, [
    { profile: plantSunrise, weight: sunriseBlend },
    { profile: plantSunset, weight: sunsetBlend },
    { profile: plantNight, weight: nightBlend },
  ]);

  const structureProfile = applyTintLayers(structureBase, [
    { profile: structureSunrise, weight: sunriseBlend },
    { profile: structureSunset, weight: sunsetBlend },
    { profile: structureNight, weight: nightBlend },
  ]);

  const pathProfile = applyTintLayers(pathBase, [
    { profile: pathSunrise, weight: sunriseBlend },
    { profile: pathSunset, weight: sunsetBlend },
    { profile: pathNight, weight: nightBlend },
  ]);

  const sunDay = this._hexToLinearRGB(0xfff0dd);
  const sunSunrise = this._hexToLinearRGB(0xffbf7b);
  const sunSunset = this._hexToLinearRGB(0xff9a6b);
  const sunNight = this._hexToLinearRGB(0xb9ceff);
  const ambientDay = this._hexToLinearRGB(0xf1f5ff);
  const ambientNight = this._hexToLinearRGB(0x687a9c);
  const hemiSkyDay = this._hexToLinearRGB(0xd9e6ff);
  const hemiSkyNight = this._hexToLinearRGB(0x1a2338);
  const hemiGroundDay = this._hexToLinearRGB(0x3a2e1a);
  const hemiGroundNight = this._hexToLinearRGB(0x0d0a08);

  const lightingBase = {
    sunColor: sunDay,
    sunIntensity: 1.05,
    ambientColor: ambientDay,
    ambientIntensity: 0.58,
    hemisphereSkyColor: hemiSkyDay,
    hemisphereGroundColor: hemiGroundDay,
    hemisphereIntensity: 0.6,
  };

  const lightingSunrise = {
    sunColor: sunSunrise,
    sunIntensity: 0.95,
    ambientColor: this._mixLinearColor(ambientNight, ambientDay, 0.7),
    ambientIntensity: 0.55,
    hemisphereSkyColor: this._mixLinearColor(hemiSkyNight, hemiSkyDay, 0.75),
    hemisphereGroundColor: this._mixLinearColor(hemiGroundNight, hemiGroundDay, 0.65),
    hemisphereIntensity: 0.58,
  };

  const lightingSunset = {
    sunColor: sunSunset,
    sunIntensity: 0.9,
    ambientColor: this._mixLinearColor(ambientNight, ambientDay, 0.6),
    ambientIntensity: 0.52,
    hemisphereSkyColor: this._mixLinearColor(hemiSkyNight, hemiSkyDay, 0.7),
    hemisphereGroundColor: this._mixLinearColor(hemiGroundNight, hemiGroundDay, 0.6),
    hemisphereIntensity: 0.56,
  };

  const lightingNight = {
    sunColor: sunNight,
    sunIntensity: 0.35,
    ambientColor: ambientNight,
    ambientIntensity: 0.38,
    hemisphereSkyColor: hemiSkyNight,
    hemisphereGroundColor: hemiGroundNight,
    hemisphereIntensity: 0.42,
  };

  const lighting = applyLightingLayers(lightingBase, [
    { profile: lightingSunrise, weight: sunriseBlend },
    { profile: lightingSunset, weight: sunsetBlend },
    { profile: lightingNight, weight: nightBlend },
  ]);

  const cloneTint = (entry) => ({
    saturation: entry.saturation,
    brightness: entry.brightness,
    warmMix: entry.warmMix,
    coolMix: entry.coolMix,
    warmColor: entry.warmColor ? this._cloneLinearColor(entry.warmColor) : null,
    coolColor: entry.coolColor ? this._cloneLinearColor(entry.coolColor) : null,
  });

  return {
    minutes: normalized,
    phase,
    daylight,
    twilight,
    nightFactor,
    terrain: terrainProfile,
    placeables: {
      plant: cloneTint(plantProfile),
      structure: cloneTint(structureProfile),
      generic: cloneTint(structureProfile),
      default: cloneTint(structureProfile),
      path: cloneTint(pathProfile),
    },
    lighting,
  };
}

function registerTerrainGeometryBasis(geometry) {
  try {
    if (!geometry || typeof geometry.getAttribute !== 'function') {
      this._terrainColorAttribute = null;
      this._terrainBaseColors = null;
      this._terrainColorGeometryId = null;
      return;
    }
    const colorAttr = geometry.getAttribute('color');
    if (!colorAttr || !colorAttr.array || !colorAttr.array.length) {
      this._terrainColorAttribute = null;
      this._terrainBaseColors = null;
      this._terrainColorGeometryId = geometry.uuid || null;
      return;
    }
    const arr = colorAttr.array;
    if (!this._terrainBaseColors || this._terrainBaseColors.length !== arr.length) {
      this._terrainBaseColors = new Float32Array(arr.length);
    }
    this._terrainBaseColors.set(arr);
    this._terrainColorAttribute = colorAttr;
    this._terrainColorGeometryId = geometry.uuid || null;
    if (!this._timeOfDayProfile) {
      this._timeOfDayProfile = this.getTimeOfDayProfile(this._sunTimeMinutes ?? 720);
    }
    if (this._timeOfDayProfile) {
      this._applyTerrainColorProfile(this._timeOfDayProfile.terrain);
    }
  } catch (_) {
    /* ignore terrain basis errors */
  }
}

function registerPlaceablePool(pool) {
  this._placeablePool = pool || null;
  if (!pool || typeof pool.applyLightingProfile !== 'function') return;
  try {
    const profile = this._timeOfDayProfile || this.getTimeOfDayProfile(this._sunTimeMinutes ?? 720);
    pool.applyLightingProfile((profile && profile.placeables) || {});
  } catch (_) {
    /* ignore placeable profile apply */
  }
}

function _applyTerrainColorProfile(terrainProfile) {
  if (!terrainProfile || !this._terrainColorAttribute || !this._terrainBaseColors) return;
  const attr = this._terrainColorAttribute;
  const dest = attr.array;
  if (!dest || dest.length !== this._terrainBaseColors.length) return;
  const saturation = this._clamp(terrainProfile.saturation ?? 1, 0, 2);
  const brightness = this._clamp(terrainProfile.brightness ?? 1, 0, 2.5);
  const warmMix = this._clamp(terrainProfile.warmMix ?? 0, 0, 1);
  const coolMix = this._clamp(terrainProfile.coolMix ?? 0, 0, 1);
  const warm = terrainProfile.warmColor || this._hexToLinearRGB(0xffc683);
  const cool = terrainProfile.coolColor || this._hexToLinearRGB(0x1e2f53);
  const len = dest.length;
  for (let i = 0; i < len; i += 3) {
    let r = this._terrainBaseColors[i];
    let g = this._terrainBaseColors[i + 1];
    let b = this._terrainBaseColors[i + 2];
    const avg = (r + g + b) / 3;
    r = avg + (r - avg) * saturation;
    g = avg + (g - avg) * saturation;
    b = avg + (b - avg) * saturation;
    if (warmMix > 0) {
      const inv = 1 - warmMix;
      r = r * inv + warm.r * warmMix;
      g = g * inv + warm.g * warmMix;
      b = b * inv + warm.b * warmMix;
    }
    if (coolMix > 0) {
      const inv = 1 - coolMix;
      r = r * inv + cool.r * coolMix;
      g = g * inv + cool.g * coolMix;
      b = b * inv + cool.b * coolMix;
    }
    r *= brightness;
    g *= brightness;
    b *= brightness;
    dest[i] = this._clamp(r, 0, 1);
    dest[i + 1] = this._clamp(g, 0, 1);
    dest[i + 2] = this._clamp(b, 0, 1);
  }
  try {
    attr.needsUpdate = true;
  } catch (_) {
    /* ignore */
  }
  const mesh = this.scene?.getObjectByName?.('TerrainMesh');
  if (mesh) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat) continue;
      if ('needsUpdate' in mat) {
        try {
          mat.needsUpdate = true;
        } catch (_) {
          /* ignore */
        }
      }
    }
  }
}

function _applyPlaceableLightingProfile(placeableProfile) {
  if (!this._placeablePool || typeof this._placeablePool.applyLightingProfile !== 'function')
    return;
  try {
    this._placeablePool.applyLightingProfile(placeableProfile || {});
  } catch (_) {
    /* ignore placeable lighting errors */
  }
}

function _applyLightProfile(lightingProfile) {
  if (!lightingProfile || typeof lightingProfile !== 'object') {
    this._pendingLightingProfile = null;
    return;
  }
  this._pendingLightingProfile = lightingProfile;
  const sun = this._sunLight;
  if (sun && lightingProfile.sunColor) {
    try {
      sun.color.setRGB(
        this._clamp(lightingProfile.sunColor.r, 0, 1),
        this._clamp(lightingProfile.sunColor.g, 0, 1),
        this._clamp(lightingProfile.sunColor.b, 0, 1)
      );
    } catch (_) {
      /* ignore */
    }
  }
  if (sun && Number.isFinite(lightingProfile.sunIntensity)) {
    try {
      sun.intensity = this._clamp(lightingProfile.sunIntensity, 0, 2);
    } catch (_) {
      /* ignore */
    }
  }
  const ambient = this._ambientLight;
  if (ambient) {
    if (lightingProfile.ambientColor) {
      try {
        ambient.color.setRGB(
          this._clamp(lightingProfile.ambientColor.r, 0, 1),
          this._clamp(lightingProfile.ambientColor.g, 0, 1),
          this._clamp(lightingProfile.ambientColor.b, 0, 1)
        );
      } catch (_) {
        /* ignore */
      }
    }
    if (Number.isFinite(lightingProfile.ambientIntensity)) {
      try {
        ambient.intensity = this._clamp(lightingProfile.ambientIntensity, 0, 1.5);
      } catch (_) {
        /* ignore */
      }
    }
  }
  const hemi = this._hemisphereLight;
  if (hemi) {
    if (lightingProfile.hemisphereSkyColor) {
      try {
        hemi.color.setRGB(
          this._clamp(lightingProfile.hemisphereSkyColor.r, 0, 1),
          this._clamp(lightingProfile.hemisphereSkyColor.g, 0, 1),
          this._clamp(lightingProfile.hemisphereSkyColor.b, 0, 1)
        );
      } catch (_) {
        /* ignore */
      }
    }
    if (lightingProfile.hemisphereGroundColor) {
      try {
        hemi.groundColor.setRGB(
          this._clamp(lightingProfile.hemisphereGroundColor.r, 0, 1),
          this._clamp(lightingProfile.hemisphereGroundColor.g, 0, 1),
          this._clamp(lightingProfile.hemisphereGroundColor.b, 0, 1)
        );
      } catch (_) {
        /* ignore */
      }
    }
    if (Number.isFinite(lightingProfile.hemisphereIntensity)) {
      try {
        hemi.intensity = this._clamp(lightingProfile.hemisphereIntensity, 0, 1.5);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

export function installLightingMethods(prototype) {
  prototype._normalizeMinutes = _normalizeMinutes;
  prototype._minutesToAzimuthDegrees = _minutesToAzimuthDegrees;
  prototype._azimuthDegreesToMinutes = _azimuthDegreesToMinutes;
  prototype._applySunElevationForTime = _applySunElevationForTime;
  prototype._applyStoredSunTime = _applyStoredSunTime;
  prototype._ensureSunAnimator = _ensureSunAnimator;
  prototype._applySunAzimuth = _applySunAzimuth;
  prototype.setSunAzimuthDegrees = setSunAzimuthDegrees;
  prototype.getSunAzimuthDegrees = getSunAzimuthDegrees;
  prototype.setSunTimeMinutes = setSunTimeMinutes;
  prototype.getSunTimeMinutes = getSunTimeMinutes;
  prototype._normalizeDegrees = _normalizeDegrees;
  prototype._applyTimeOfDayProfile = _applyTimeOfDayProfile;
  prototype._clamp = _clamp;
  prototype._srgbToLinear = _srgbToLinear;
  prototype._hexToLinearRGB = _hexToLinearRGB;
  prototype._cloneLinearColor = _cloneLinearColor;
  prototype._mixLinearColor = _mixLinearColor;
  prototype._smoothstep = _smoothstep;
  prototype._timeWindowFactor = _timeWindowFactor;
  prototype.getTimeOfDayProfile = getTimeOfDayProfile;
  prototype.registerTerrainGeometryBasis = registerTerrainGeometryBasis;
  prototype.registerPlaceablePool = registerPlaceablePool;
  prototype._applyTerrainColorProfile = _applyTerrainColorProfile;
  prototype._applyPlaceableLightingProfile = _applyPlaceableLightingProfile;
  prototype._applyLightProfile = _applyLightProfile;
}
