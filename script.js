/* ================================================================
   Timer Bar Feedback — клиентская логика
   - Маска телефона с автоподстановкой +7
   - Валидация полей
   - Подсчёт символов
   - Поп-ап "Спасибо" через модальное окно
   - Отправка через настраиваемый backend
   ================================================================ */

(function () {
  'use strict';

  // ====== CONFIG ====================================================
  const CONFIG = window.FEEDBACK_CONFIG || {
    endpoint: '',          // например: '/api/feedback'
    fallbackToMailto: false, // по умолчанию ВЫКЛ — модалка показывается без mailto
    fallbackEmail: 'owner@timerbar.ru',
  };

  // ====== DOM ========================================================
  const form = document.getElementById('feedbackForm');
  const submitBtn = document.getElementById('submitBtn');
  const messageEl = document.getElementById('message');
  const counter = document.getElementById('counter');
  const modalEl = document.getElementById('successModal');

  const TYPE_LABEL = {
    complaint: 'Жалоба',
    suggestion: 'Предложение',
    gratitude: 'Благодарность',
    review: 'Отзыв',
  };

  const TYPE_EMOJI = {
    complaint: '😟',
    suggestion: '💡',
    gratitude: '🙏',
    review: '⭐',
  };

  // ====== HELPERS ====================================================
  function fieldEl(name) { return form.querySelector(`[name="${name}"]`); }
  function errorEl(name) { return form.querySelector(`[data-error-for="${name}"]`); }
  function fieldWrap(name) { return fieldEl(name).closest('.field'); }
  function setError(name, message) {
    const wrap = fieldWrap(name);
    const err = errorEl(name);
    if (message) {
      wrap.classList.add('has-error');
      err.textContent = message;
    } else {
      wrap.classList.remove('has-error');
      err.textContent = '';
    }
  }
  function clearAllErrors() {
    form.querySelectorAll('.field').forEach((f) => f.classList.remove('has-error'));
    form.querySelectorAll('.field__error').forEach((e) => (e.textContent = ''));
  }

  // ====== PHONE MASK ================================================
  // Поддержка кодов стран: Россия +7, Украина +380, Беларусь +375,
  // Казахстан +7, Узбекистан +998, Армения +374, Грузия +995,
  // Азербайджан +994, Молдова +373, Таджикистан +992, Кыргызстан +996,
  // Туркменистан +993, Латвия +371, Литва +370, Эстония +372.
  const COUNTRY_CODES = {
    '7':  { name: 'Россия/Казахстан', maxLen: 10 },
    '380': { name: 'Украина',          maxLen: 9  },
    '375': { name: 'Беларусь',         maxLen: 9  },
    '998': { name: 'Узбекистан',       maxLen: 9  },
    '374': { name: 'Армения',          maxLen: 8  },
    '995': { name: 'Грузия',           maxLen: 9  },
    '994': { name: 'Азербайджан',      maxLen: 9  },
    '373': { name: 'Молдова',          maxLen: 8  },
    '992': { name: 'Таджикистан',      maxLen: 9  },
    '996': { name: 'Кыргызстан',       maxLen: 9  },
    '993': { name: 'Туркменистан',     maxLen: 8  },
    '371': { name: 'Латвия',           maxLen: 8  },
    '370': { name: 'Литва',            maxLen: 8  },
    '372': { name: 'Эстония',          maxLen: 8  },
  };

  function detectCountryCode(digits) {
    // digits — только цифры введённого номера без ведущего плюса
    // Ищем самый длинный совпадающий код в COUNTRY_CODES
    for (const code of Object.keys(COUNTRY_CODES).sort((a, b) => b.length - a.length)) {
      if (digits.startsWith(code)) return { code, ...COUNTRY_CODES[code] };
    }
    return null;
  }

  function formatPhone(raw) {
    // Оставляем только цифры
    let digits = raw.replace(/\D/g, '');

    // Если начинается с 8 — заменяем на 7 (РФ)
    if (digits.startsWith('8') && digits.length >= 1) {
      digits = '7' + digits.slice(1);
    }

    // Определяем код страны
    const cc = detectCountryCode(digits);

    if (!cc) {
      // Ничего не подставилось — пользователь ещё не начал вводить
      // или ввёл мусор. Возвращаем то, что есть.
      if (digits.length === 0) return '';
      return '+' + digits;
    }

    const ccDigits = digits.slice(0, cc.code.length);
    const rest = digits.slice(cc.code.length);

    // Форматируем остаток по маске: "XXX XXX-XX-XX" (для РФ 10 цифр)
    // Универсально: группы по 3-2-2 для совместимости
    let formattedRest;
    if (cc.maxLen === 10) {
      // РФ/КЗ: XXX-XXX-XX-XX
      formattedRest = rest
        .slice(0, 3)
        + (rest.length > 3 ? ' ' + rest.slice(3, 6) : '')
        + (rest.length > 6 ? '-' + rest.slice(6, 8) : '')
        + (rest.length > 8 ? '-' + rest.slice(8, 10) : '');
    } else if (cc.maxLen === 9) {
      // UA/BY/UZ/GE/AZ/TJ/KG: XX-XXX-XX-XX
      formattedRest = rest
        .slice(0, 2)
        + (rest.length > 2 ? ' ' + rest.slice(2, 5) : '')
        + (rest.length > 5 ? '-' + rest.slice(5, 7) : '')
        + (rest.length > 7 ? '-' + rest.slice(7, 9) : '');
    } else {
      // 8 цифр (AM/MD/TM/LV/LT/EE): XX-XXX-XXX
      formattedRest = rest
        .slice(0, 2)
        + (rest.length > 2 ? ' ' + rest.slice(2, 5) : '')
        + (rest.length > 5 ? '-' + rest.slice(5, 8) : '');
    }

    return '+' + ccDigits + ' ' + formattedRest.trim();
  }

  function setupPhoneMask() {
    const phone = fieldEl('phone');
    let prevValue = '';

    function onInput() {
      const cursorPos = phone.selectionStart;
      const before = phone.value.slice(0, cursorPos);
      const digitsBefore = before.replace(/\D/g, '').length;

      const formatted = formatPhone(phone.value);
      phone.value = formatted;
      prevValue = formatted;

      // Восстанавливаем курсор после форматирования
      try {
        const newCursor = positionForDigits(formatted, digitsBefore);
        phone.setSelectionRange(newCursor, newCursor);
      } catch (e) {
        // ignore
      }
    }

    function positionForDigits(str, digitCount) {
      let seen = 0;
      for (let i = 0; i < str.length; i++) {
        if (/\d/.test(str[i])) {
          seen++;
          if (seen === digitCount) return i + 1;
        }
      }
      return str.length;
    }

    function onFocus() {
      if (!phone.value) {
        // Автоподстановка +7 при первом фокусе
        phone.value = '+7 ';
        prevValue = '+7 ';
        try {
          phone.setSelectionRange(3, 3);
        } catch (e) {}
      }
    }

    function onBlur() {
      if (phone.value.trim() === '+7' || phone.value.trim() === '') {
        phone.value = '';
      }
    }

    function onKeyDown(e) {
      // Backspace: если курсор сразу после "+7 " — не даём удалить префикс
      if (e.key === 'Backspace' && phone.value.startsWith('+7 ') &&
          phone.selectionStart <= 3 && phone.selectionEnd <= 3) {
        e.preventDefault();
        try {
          phone.setSelectionRange(3, 3);
        } catch (err) {}
      }
    }

    phone.addEventListener('input', onInput);
    phone.addEventListener('focus', onFocus);
    phone.addEventListener('blur', onBlur);
    phone.addEventListener('keydown', onKeyDown);
  }

  // ====== VALIDATION =================================================
  function validateField(name) {
    const el = fieldEl(name);
    const v = (el.value || '').trim();

    if (name === 'name') {
      if (!v) return setError(name, 'Укажите имя'), false;
      if (v.length < 2) return setError(name, 'Слишком короткое имя'), false;
      return setError(name, ''), true;
    }

    if (name === 'phone') {
      if (!v) return setError(name, 'Укажите телефон'), false;
      const digits = v.replace(/\D/g, '');
      const cc = detectCountryCode(digits);
      if (!cc) {
        return setError(name, 'Не удалось распознать код страны'), false;
      }
      const local = digits.slice(cc.code.length);
      if (local.length < cc.maxLen) {
        return setError(name, `Введите ${cc.maxLen} цифр номера`), false;
      }
      return setError(name, ''), true;
    }

    if (name === 'type') {
      if (!v) return setError(name, 'Выберите тип обращения'), false;
      if (!['complaint', 'suggestion', 'gratitude', 'review'].includes(v)) {
        return setError(name, 'Недопустимое значение'), false;
      }
      return setError(name, ''), true;
    }

    if (name === 'message') {
      if (!v) return setError(name, 'Опишите ситуацию'), false;
      if (v.length < 10) return setError(name, 'Минимум 10 символов'), false;
      return setError(name, ''), true;
    }

    return true;
  }

  function validateAll() {
    let ok = true;
    ['name', 'phone', 'type', 'message'].forEach((n) => {
      if (!validateField(n)) ok = false;
    });
    return ok;
  }

  // ====== LIVE COUNTER ===============================================
  function updateCounter() {
    const len = (messageEl.value || '').length;
    counter.textContent = len;
    counter.style.color = len > 1800 ? 'var(--accent)' : '';
  }

  // ====== MODAL (native <dialog>) ===================================
  function openModal() {
    // <dialog> сам центрируется браузером + имеет встроенный backdrop + Escape
    if (typeof modalEl.showModal === 'function') {
      modalEl.showModal();
    } else {
      // fallback для очень старых браузеров
      modalEl.setAttribute('open', '');
    }
  }
  function closeModal() {
    if (typeof modalEl.close === 'function') {
      modalEl.close();
    } else {
      modalEl.removeAttribute('open');
    }
    resetForm();
  }

  function setupModal() {
    // Закрытие по клику на кнопку
    const closeBtn = document.getElementById('modalCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    // Закрытие по клику на сам dialog (backdrop) — клик по самому элементу dialog
    modalEl.addEventListener('click', (e) => {
      // если клик пришёл на сам dialog (а не на его содержимое) — закрыть
      const rect = modalEl.getBoundingClientRect();
      const insideDialog =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!insideDialog) closeModal();
    });
    // <dialog> сам обрабатывает Escape — ничего не нужно
  }

  // ====== SUBMIT =====================================================
  function buildPayload() {
    return {
      name: fieldEl('name').value.trim(),
      phone: fieldEl('phone').value.trim(),
      type: fieldEl('type').value,
      typeLabel: TYPE_LABEL[fieldEl('type').value] || fieldEl('type').value,
      message: fieldEl('message').value.trim(),
      createdAt: new Date().toISOString(),
      source: {
        url: location.href,
        referrer: document.referrer || null,
        ua: navigator.userAgent,
        lang: navigator.language,
      },
    };
  }

  function setLoading(state) {
    if (state) {
      submitBtn.classList.add('is-loading');
      submitBtn.disabled = true;
    } else {
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;
    }
  }

  function resetForm() {
    form.reset();
    clearAllErrors();
    updateCounter();
    // Не очищаем поле телефона после reset — оно останется пустым,
    // маска подставит +7 при следующем фокусе
    fieldEl('name').focus();
  }

  function fallbackToMailto(payload) {
    const subject = encodeURIComponent(`[${payload.typeLabel}] Timer Bar — обращение от ${payload.name}`);
    const body = encodeURIComponent(
      `Тип: ${payload.typeLabel}\n` +
      `Имя: ${payload.name}\n` +
      `Телефон: ${payload.phone}\n` +
      `Дата: ${new Date(payload.createdAt).toLocaleString('ru-RU')}\n\n` +
      `Сообщение:\n${payload.message}\n`
    );
    location.href = `mailto:${CONFIG.fallbackEmail}?subject=${subject}&body=${body}`;
  }

  async function send(payload) {
    if (!CONFIG.endpoint) {
      // Демо-режим: endpoint не настроен. Ничего не отправляем, просто имитируем успех.
      if (CONFIG.fallbackToMailto) {
        fallbackToMailto(payload);
        return { ok: true, channel: 'mailto' };
      }
      // Сохраняем данные в console для отладки (видно в DevTools)
      console.info('[Timer Bar Feedback] Демо-режим: обращение не отправлено (endpoint не задан).', payload);
      return { ok: true, channel: 'demo' };
    }

    const res = await fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Сервер вернул ${res.status}`);
    }
    return res.json().catch(() => ({ ok: true }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    clearAllErrors();
    if (!validateAll()) {
      const firstError = form.querySelector('.field.has-error input, .field.has-error textarea');
      if (firstError) firstError.focus();
      return;
    }

    const payload = buildPayload();
    setLoading(true);

    try {
      await send(payload);
      openModal();
    } catch (err) {
      console.error('Submit error:', err);
      const submitErr = form.querySelector('.legal');
      if (submitErr) {
        submitErr.textContent =
          'Не удалось отправить. Попробуйте ещё раз или позвоните: +7 918 499-01-01';
        submitErr.style.color = 'var(--error)';
      }
    } finally {
      setLoading(false);
    }
  }

  // ====== EVENTS =====================================================
  ['name', 'phone', 'type', 'message'].forEach((n) => {
    fieldEl(n).addEventListener('blur', () => {
      if (fieldEl(n).value.trim()) validateField(n);
    });
    fieldEl(n).addEventListener('input', () => setError(n, ''));
  });

  messageEl.addEventListener('input', updateCounter);
  form.addEventListener('submit', onSubmit);

  // ====== INIT =======================================================
  setupPhoneMask();
  setupModal();
  updateCounter();
  fieldEl('name').focus();
})();