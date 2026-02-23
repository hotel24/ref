/**
 * СЕРВИС ФИЛЬТРАЦИИ (FilterService.js)
 */
const FilterService = {
    state: {
        priceMin: 0,
        priceMax: 50000,
        stars: [], // [3, 4, 5]
        sortBy: 'popular'
    },

    filterTimer: null,

    init() {
        this._renderHistogram();
        this._bindPriceSlider();
        this._bindInputs();
        this._bindStars();
        console.log("📝 FilterService: Ready");
        const modal = document.getElementById('filters-modal');
        if (modal) {
            modal.addEventListener('mousedown', (e) => {
                // Если клик был именно по подложке (modal), а не по контенту (modal-content)
                if (e.target === modal) {
                    this.close();
                }
            });
        }
    },

    updateRangeLimits(min, max) {
        const minRange = document.getElementById('min-range');
        const maxRange = document.getElementById('max-range');

        if (!minRange || !maxRange) return;

        // 1. Обновляем только ШКАЛУ (границы допустимого)
        minRange.min = min;
        minRange.max = max;
        maxRange.min = min;
        maxRange.max = max;

        // 2. ПРОВЕРКА: Если старое выбранное значение вылетело за новую шкалу
        // Например: было выбрано 1000, а новая минималка в городе 2000.
        if (this.state.priceMin < min) this.state.priceMin = min;
        if (this.state.priceMax > max) this.state.priceMax = max;

        // Если в стейте еще пусто (первый запуск), тогда ставим в края
        if (this.state.priceMin === 0 && this.state.priceMax === 150000) {
            this.state.priceMin = min;
            this.state.priceMax = max;
        }

        // 3. Устанавливаем ползунки в сохраненные позиции
        minRange.value = this.state.priceMin;
        maxRange.value = this.state.priceMax;

        // 4. Отрисовываем визуальную часть (трек, текст) без вызова запроса
        this._updateAll(this.state.priceMin, this.state.priceMax);

        console.log(`📍 Шкала обновлена до ${min}-${max}. Выбор сохранен: ${this.state.priceMin}-${this.state.priceMax}`);
    },

    // 1. ГЛАВНАЯ ЛОГИКА ФИЛЬТРАЦИИ (вызывается из App.render)
    apply(hotels) {
        if (!hotels) return [];

        return hotels.filter(h => {
            const price = parseFloat(h.price) || 0;
            const matchesPrice = price >= this.state.priceMin && price <= this.state.priceMax;
            const matchesStars = this.state.stars.length === 0 || this.state.stars.includes(Number(h.stars));

            return matchesPrice && matchesStars;
        });
    },

    // 2. ОБНОВЛЕНИЕ UI И СОСТОЯНИЯ
    _updateAll(valMin, valMax) {
        const minRange = document.getElementById('min-range');
        const maxRange = document.getElementById('max-range');
        const track = document.querySelector('.slider-track');
        const minInput = document.getElementById('min-p-input');
        const maxInput = document.getElementById('max-p-input');
        const display = document.getElementById('p-txt-desktop'); // Текст на кнопке/инфо

        // 1. Валидация (защита от перехлеста)
        if (valMin > valMax) [valMin, valMax] = [valMax, valMin];

        // 2. МГНОВЕННОЕ ОБНОВЛЕНИЕ ТЕКСТА (Инфо)
        // Используем Utils.formatPrice для красивого вывода (например, 150 000 ₽)
        const formattedMax = typeof Utils !== 'undefined' ? Utils.formatPrice(valMax) : valMax;
        const formattedMin = typeof Utils !== 'undefined' ? Utils.formatPrice(valMin) : valMin;

        if (display) {
            display.innerText = `от ${formattedMin} до ${formattedMax}`;
        }

        // 3. Синхронизация текстовых инпутов в модалке
        if (minInput) minInput.value = formattedMin;
        if (maxInput) maxInput.value = formattedMax;

        // 4. Визуализация полоски (трека)
        const maxLimit = minRange ? minRange.max : 50000;
        const p1 = (valMin / maxLimit) * 100;
        const p2 = (valMax / maxLimit) * 100;

        if (track) {
            track.style.left = p1 + "%";
            track.style.width = (p2 - p1) + "%";
        }

        // 5. Запись в стейт
        this.state.priceMin = valMin;
        this.state.priceMax = valMax;

        // Подсветка гистограммы (если есть)
        this._updateHistogramHighlight(p1, p2);
    },

    updatePriceUI(val) {
        const display = document.getElementById('p-txt-desktop');
        if (display) {
            // Предполагается, что Utils.formatPrice определен глобально
            display.innerText = `до ${typeof Utils !== 'undefined' ? Utils.formatPrice(val) : val}`;
        }

        // Живое обновление списка с debounce (чтобы не тормозило при движении ползунка)
        clearTimeout(this.filterTimer);
        this.filterTimer = setTimeout(() => App.refreshData(), 400);
    },

    // 3. ПРИВЯЗКА СОБЫТИЙ (Слайдеры)
    _bindPriceSlider() {
        const minRange = document.getElementById('min-range');
        const maxRange = document.getElementById('max-range');

        if (!minRange || !maxRange) return;

        // Только визуальное обновление при движении
        const handleLiveUpdate = () => {
            this._updateAll(parseInt(minRange.value), parseInt(maxRange.value));
        };

        minRange.oninput = handleLiveUpdate;
        maxRange.oninput = handleLiveUpdate;

        // УБИРАЕМ onchange: App.refreshData здесь больше не нужен
        minRange.onchange = null;
        maxRange.onchange = null;
    },
    applyFilters() {
        // 1. Закрываем модальное окно
        this.close();

        // 2. Делаем запрос к серверу (isNewSearch = true, чтобы сбросить пагинацию на 1 стр)
        console.log("🚀 Применяем фильтры и загружаем данные...");
        App.refreshData(null, null, true);
    },
    // 4. ПРИВЯЗКА СОБЫТИЙ (Ручной ввод в инпуты)
    _bindInputs() {
        const minInput = document.getElementById('min-p-input');
        const maxInput = document.getElementById('max-p-input');

        if (!minInput || !maxInput) return;

        const syncFromInput = () => {
            const valMin = parseInt(minInput.value.replace(/\D/g, '')) || 0;
            const valMax = parseInt(maxInput.value.replace(/\D/g, '')) || 50000;
            this._updateAll(valMin, valMax);
            App.refreshData();
        };

        minInput.onchange = syncFromInput;
        maxInput.onchange = syncFromInput;
    },

    // 5. ГИСТОГРАММА
    _renderHistogram() {
        const hist = document.getElementById('price-histogram');
        if (!hist) return;

        hist.innerHTML = Array.from({ length: 40 }, () =>
            `<div class="hist-bar" style="height: ${Math.random() * 40 + 5}px"></div>`
        ).join('');
    },

    _updateHistogramHighlight(p1, p2) {
        const bars = document.querySelectorAll('.hist-bar');
        bars.forEach((bar, i) => {
            const barPos = (i / bars.length) * 100;
            bar.style.background = (barPos >= p1 && barPos <= p2) ? '#222' : '#ddd';
        });
    },

    // 6. ЗВЕЗДЫ
    _bindStars() {
        document.querySelectorAll('.star-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                this.state.stars = Array.from(document.querySelectorAll('.star-cb:checked'))
                    .map(el => Number(el.value));
                App.refreshData();
            });
        });
    },

    // 7. МОДАЛЬНОЕ ОКНО
    open() {
        const modal = document.getElementById('filters-modal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    },

    close() {
        const modal = document.getElementById('filters-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }
};
