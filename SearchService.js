/**
 * СЕРВИС ПОИСКА И АВТОКОМПЛИТА (SearchService.js)
 */
const SearchService = {
    quickCities: ["Москва", "Санкт-Петербург", "Казань", "Сочи", "Екатеринбург"],
    debounceTimer: null,

    // 1. Инициализация слушателей
    init(ids) {
        ids.forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            this._bindEvents(input, id);
        });
        console.log("🔍 SearchService: Initialized for", ids);
    },


    initDatepicker() {
        const commonOptions = {
            range: true,
            multipleDatesSeparator: ' - ',
            minDate: new Date(),
            autoClose: true,
            onSelect: ({ date, datepicker }) => {
                if (date.length === 2) {
                    const from = date[0].toISOString().split('T')[0];
                    const to = date[1].toISOString().split('T')[0];

                    // Сохраняем в стейт
                    App.state.dates.from = from;
                    App.state.dates.to = to;

                    // Обновляем текст в интерфейсе
                    const text = `${Utils.formatDateHuman(from)} - ${Utils.formatDateHuman(to)}`;
                    document.getElementById('desk-date-display').innerText = text;
                    document.getElementById('mob-date-display').innerText = text;

                    App.refreshData(); // Загружаем отели
                }
            }
        };

        // Десктопный календарь (2 месяца)
        new AirDatepicker('#desk-date-input', {
            ...commonOptions,
            container: '#desk-date-trigger',
            numberOfMonths: 2
        });

        // Мобильный календарь (1 месяц)
        new AirDatepicker('#mob-date-display', {
            ...commonOptions,
            container: '#mobOverlay'
        });

        // Открытие календаря по клику на сегмент
        document.getElementById('desk-date-trigger').addEventListener('click', () => {
            document.getElementById('desk-date-input').focus();
        });
    },

    // ЛОГИКА ГОСТЕЙ
    initGuests() {
        const trigger = document.getElementById('guests-trigger');
        const dropdown = document.getElementById('guests-dropdown');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', () => dropdown.classList.add('hidden'));
        dropdown.addEventListener('click', (e) => e.stopPropagation());
    },

    // 2. Внутренние события инпута
    _bindEvents(input, id) {
        const resultsId = (id === 'ac-input-mob') ? 'ac-results-mob' : 'ac-results';
        const segment = input.closest('.search-segment');

        // Клик по сегменту -> Фокус
        segment?.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-clear')) return;
            input.focus();
        });

        // ФОКУС: Очистка и показ быстрых городов
        input.addEventListener('focus', () => {
            input.dataset.oldValue = input.value;
            input.value = '';
            segment?.classList.add('is-active');
            this.renderQuickList(resultsId);

            if (typeof SearchOverlay !== 'undefined') SearchOverlay.open();
        });

        // ВВОД: Поиск через Яндекс.Подсказки
        input.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            const btnClear = segment?.querySelector('.btn-clear');
            if (btnClear) btnClear.classList.toggle('hidden', query.length === 0);

            clearTimeout(this.debounceTimer);

            if (query.length < 2) {
                this.renderQuickList(resultsId);
                return;
            }

            this.debounceTimer = setTimeout(async () => {
                if (typeof ymaps !== 'undefined' && ymaps.suggest) {
                    try {
                        const items = await ymaps.suggest(query);
                        this.renderSearchList(items, resultsId);
                    } catch (err) {
                        console.error("Suggest error:", err);
                    }
                }
            }, 300);
        });

        // ПОТЕРЯ ФОКУСА: Откат значения
        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (input.value.trim() === '' && input.dataset.oldValue) {
                    input.value = input.dataset.oldValue;
                }
                segment?.classList.remove('is-active');
                document.getElementById(resultsId)?.classList.add('hidden');
            }, 250);
        });
    },

    // 3. МЕТОД ВЫБОРА ГОРОДА (Главный вход в поиск)
    async selectPlace(address) {
        if (!address) return;
        console.log("🎯 SearchService: Selecting", address);

        // Синхронизируем все инпуты (Desk & Mob)
        ['ac-input-desk', 'ac-input-mob'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.value = address;
                el.dataset.oldValue = address; // Важно для предотвращения отката в blur
                el.blur();
            }
        });

        // Закрываем оверлеи
        if (typeof SearchOverlay !== 'undefined') SearchOverlay.close();
        if (typeof closeMobSearch === 'function') closeMobSearch();
        this._hideAllResults();

        // Обновляем состояние приложения и запускаем процесс в App
        const cityName = address.split(',')[0].trim();
        App.state.place = cityName;

        try {
            // Геокодинг через Яндекс
            const res = await ymaps.geocode(address);
            const firstObj = res.geoObjects.get(0);
            if (!firstObj) return;

            const coords = firstObj.geometry.getCoordinates();

            // Сообщаем модулям о новом месте
            App.state.map.lastLat = coords[0];
            App.state.map.lastLng = coords[1];

            // Запускаем общую логику обновления из ref.js (App core)
            App.refreshData(coords[0], coords[1]);

        } catch (e) {
            console.error("Geocode error:", e);
        }
    },

    // 4. РЕНДЕРИНГ СПИСКОВ
    renderQuickList(targetId) {
        const res = document.getElementById(targetId);
        if (!res) return;

        res.innerHTML = `
            <div class="ac-hotel24-header">ПОПУЛЯРНЫЕ НАПРАВЛЕНИЯ</div>
            <div class="ac-hotel24-grid">
                ${this.quickCities.map(city => `
                    <div class="ac-item-hotel24" onmousedown="SearchService.selectPlace('${city}'); event.stopPropagation();">
                        <div class="ac-icon-wrap">📍</div>
                        <span>${city}</span>
                    </div>
                `).join('')}
            </div>
        `;
        res.classList.remove('hidden');
    },

    renderSearchList(items, targetId) {
        const res = document.getElementById(targetId);
        if (!res || !items.length) {
            res?.classList.add('hidden');
            return;
        }

        res.innerHTML = items.map(i => {
            const val = (typeof i === 'string') ? i : i.value;
            const safeVal = val.replace(/'/g, "\\'");
            return `
                <div class="ac-item-hotel24" onmousedown="SearchService.selectPlace('${safeVal}'); event.stopPropagation();">
                    <div class="ac-icon-wrap">🔍</div>
                    <span>${val}</span>
                </div>
            `;
        }).join('');
        res.classList.remove('hidden');
    },

    _hideAllResults() {
        document.getElementById('ac-results')?.classList.add('hidden');
        document.getElementById('ac-results-mob')?.classList.add('hidden');
    }

    ,

};


// Глобальная функция для кнопок +/- (changeG)
window.changeG = (mode, delta, type) => {
    const key = type === 'adults' ? 'adults' : 'children';
    let val = App.state.guests[key] + delta;

    if (type === 'adults' && val < 1) val = 1;
    if (type === 'kids' && val < 0) val = 0;

    App.state.guests[key] = val;

    // Обновляем текст в UI
    const total = App.state.guests.adults + App.state.guests.children;
    const text = `${total} ${Utils.pluralize(total, ['гость', 'гостя', 'гостей'])}`;

    document.getElementById('desk-guests-display').innerText = text;
    document.getElementById(`cnt-${mode}-${type}`).innerText = val;

    // Авто-обновление при изменении
    clearTimeout(window.guestTimer);
    window.guestTimer = setTimeout(() => App.refreshData(), 800);
};


window.openMobSearch = () => {
    document.getElementById('mobOverlay').classList.add('active');
    document.body.style.overflow = 'hidden'; // Блокируем скролл сайта
};

window.closeMobSearch = () => {
    document.getElementById('mobOverlay').classList.remove('active');
    document.body.style.overflow = '';
};
