/**
 * ГЛОБАЛЬНОЕ СОСТОЯНИЕ ПРИЛОЖЕНИЯ
 */

let datePicker = null;

let cityName;


const App = {
    state: {
        hotels: [],
        place: "Мой город",
        guests: { adults: 2, kids: 0, ages: [] },
        pagination: { current: 1, isFetching: false, allLoaded: false },
        map: { isLoaded: false, isMoving: false, instance: null, clusterer: null, searchMark: null, lastLat : null, lastLng : null, marks: {} },
        dates: [new Date(new Date().setDate(new Date().getDate() + 1)), new Date(new Date().setDate(new Date().getDate() + 2))]
    },

    // Утилиты
    utils: {
        getCityIn(city) {
            if (!city) return "выбранном месте";
            const exceptions = { "Москва": "Москве", "Санкт-Петербург": "Санкт-Петербурге", "Казань": "Казани", "Сочи": "Сочи" };
            if (exceptions[city]) return exceptions[city];
            if (city.match(/[бвгджзйклмнпрстфхцчшщ]$/i)) return city + "е";
            if (city.endsWith("а")) return city.slice(0, -1) + "е";
            return city;
        },
        formatUrlDate: (dateStr) => {
            const d = new Date(dateStr);
            return isNaN(d) ? null : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        }
    },

    // Массовое обновление текста/значений в DOM
    updateUIElements(selectors, value) {
  //  console.log(value)
        selectors.forEach(id => {
            const el = document.getElementById(id);
            if (el) el[el.tagName === 'INPUT' ? 'value' : 'innerText'] = value;
        });
    }
};



 



/**
 * РАБОТА С КАРТОЙ (YANDEX MAPS) — ФИНАЛЬНАЯ ВЕРСИЯ 2026
 */
const MapModule = {
    async load(lat, lng, cityName) {
        if (App.state.map.isLoaded) return;

        await this._injectScript();
        ymaps.ready(() => {
            // Инициализация карты
            App.state.map.instance = new ymaps.Map("y-map", {
                center: [lat, lng],
                zoom: 14,
                controls: ['zoomControl'],
                yandexMapDisablePoiInteractivity: true
            }, {
                touchScroll: true,
                paneEventsEnabled: true,
                balloonAutoPan: true,
                balloonAutoPanMargin: 80
            });

            this._initClusterer();
            this.updateSearchMark(lat, lng, cityName);
            this._setupEvents();

            // Сохраняем начальную точку для отслеживания смещений
            App.state.map.lastLat = lat;
            App.state.map.lastLng = lng;

            App.state.map.isLoaded = true;
            if (App.state.hotels.length > 0) render(false);

            loadHotels(lat, lng);
        });
    },

    _initClusterer() {
        App.state.map.clusterer = new ymaps.Clusterer({
            preset: 'islands#invertedBlueClusterIcons',
            gridSize: 64,
            hasBalloon: true,
            groupByCoordinates: false
        });
        App.state.map.instance.geoObjects.add(App.state.map.clusterer);
    },

    _setupEvents() {
        // 1. Клик по карте закрывает всё лишнее
        App.state.map.instance.events.add('click', (e) => {
            if (e.get('target') === App.state.map.instance) {
                App.state.map.instance.balloon.close();
            }
        });

        // 2. Очистка URL при закрытии балуна вручную
        App.state.map.instance.events.add('balloonclose', () => {
            const url = new URL(window.location);
            if (url.searchParams.has('hotel_id')) {
                url.searchParams.delete('hotel_id');
                window.history.pushState({}, '', url);
            }
        });

        // 3. Умное отслеживание перемещений (Threshold 400m)
        App.state.map.instance.events.add('boundschange', () => {
            if (App.state.map.isMoving || App.state.pagination.isFetching) return;

            const newCenter = App.state.map.instance.getCenter();
            const newLat = newCenter[0];
            const newLng = newCenter[1];

            const distance = this.getDistance(App.state.map.lastLat, App.state.map.lastLng, newLat, newLng);

            // Если смещение меньше 400 метров — игнорируем (защита от балунов и микро-двигов)
            if (distance < 1000) return;

            App.state.map.lastLat = newLat;
            App.state.map.lastLng = newLng;

            syncStateToURL();
            App.state.pagination.current = 1;
            loadHotels();
        });
    },

    // Формула гаверсинусов для расчета метров между координатами
    getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c * 1000;
    },

    updateSearchMark(lat, lng, cityName) {
        if (!App.state.map.instance) return;
        if (!App.state.map.searchMark) {
            const Layout = ymaps.templateLayoutFactory.createClass(`<div class="map-price-tag dark-tag">$[properties.iconContent]</div>`);
            App.state.map.searchMark = new ymaps.Placemark([lat, lng], { iconContent: cityName }, {
                iconLayout: 'default#imageWithContent',
                iconContentLayout: Layout,
                iconImageSize: [30, 30],
                iconContentOffset: [-40, -15],
                zIndex: 2000
            });
            App.state.map.instance.geoObjects.add(App.state.map.searchMark);
        } else {
            App.state.map.searchMark.geometry.setCoordinates([lat, lng]);
            App.state.map.searchMark.properties.set('iconContent', cityName);
        }
    },

    highlightMark(id, isHover) {
        const mark = App.state.map.marks[id];
        if (!mark || !App.state.map.clusterer) return;
        const state = App.state.map.clusterer.getObjectState(mark);
        const zIndex = isHover ? 1000 : 1;

        if (state.isClustered && state.cluster) {
            state.cluster.options.set({
                preset: isHover ? 'islands#invertedRedClusterIcons' : 'islands#invertedBlueClusterIcons',
                zIndex
            });
        }

        // Подсвечиваем саму метку (ценник)
        const el = document.getElementById(`mark-${id}`);
        if (el) el.classList.toggle('active-mark', isHover);

        mark.options.set('zIndex', zIndex);
    },

    createBalloonContent(h) {
        const nights = typeof getNightsCount === 'function' ? getNightsCount() : 1;
        const priceStr = h.price ? h.price.toLocaleString() : '---';
        const imgs = h.imgs || (h.images ? (Array.isArray(h.images) ? h.images : [h.images]) : ["https://www.hotel24.ru"]);
        const sliderId = `balloon-slider-${h.id}`;

        return `
        <div class="map-balloon-vertical">
            <div class="balloon-img-top">
                <div class="balloon-slides-container" id="${sliderId}">
                    ${imgs.map(src => `<div class="balloon-slide"><img src="${src}" loading="lazy" onclick="openHotelDetail('${h.id}')"></div>`).join('')}
                </div>
                
                ${imgs.length > 1 ? `
                    <button class="balloon-nav prev" onclick="moveBalloonSlide('${sliderId}', -1)">❮</button>
                    <button class="balloon-nav next" onclick="moveBalloonSlide('${sliderId}', 1)">❯</button>
                ` : ''}

                <div class="balloon-rating-badge">★ ${h.rating || '5.0'}</div>
                <button class="balloon-close-btn" onclick="App.state.map.instance.balloon.close()">×</button>
            </div>
            <div class="balloon-info-bottom" onclick="openHotelDetail('${h.id}')">
                <div class="balloon-title">${h.hotel_name}</div>
                <div class="balloon-meta">${h.type_hotel || 'Отель'} · ${h.dist || '0.5'} км</div>
                <div class="balloon-price-row">
                    <span class="price-val">${priceStr} ₽</span>
                    <span class="price-sub">за ${nights} н.</span>
                </div>
            </div>
        </div>`;
    },

    _injectScript() {
        return new Promise(res => {
            if (window.ymaps) return res();
            const s = document.createElement('script');
            s.src = "https://api-maps.yandex.ru/2.1?&amp;coordorder=latlong&lang=ru-RU&apikey=f4c1980d-6b6d-4195-adb1-cadd74595273&suggest_apikey=1468de26-3e87-443c-9a71-fa368d0043b0";
            s.onload = res;
            document.head.appendChild(s);
        });
    }
};

// Глобальная функция для слайдера в балуне
window.moveBalloonSlide = (sliderId, dir) => {
    const el = document.getElementById(sliderId);
    if (el) el.scrollBy({ left: dir * el.offsetWidth, behavior: 'smooth' });
};



















/**
 * СЕРВИС ЗАГРУЗКИ ДАННЫХ
 */
async function loadHotels(fLat = null, fLng = null, isNextPage = false) {
    if (App.state.pagination.isFetching || (isNextPage && App.state.pagination.allLoaded)) return;

    App.state.pagination.isFetching = true;
    startLoader();
    if (!isNextPage) LoaderModule.showSkeletons();

    try {
        const params = new URLSearchParams(window.location.search);
        const sc = JSON.parse(document.getElementById('start-coords')?.textContent || '{}');
        const lat = fLat || (App.state.map.instance ? App.state.map.instance.getCenter()[0] : parseFloat(params.get('lat') || sc.lat));
        const lng = fLng || (App.state.map.instance ? App.state.map.instance.getCenter()[1] : parseFloat(params.get('lng') || sc.lng));
        const b = App.state.map.instance ? App.state.map.instance.getBounds() : [[lat - 0.05, lng - 0.05], [lat + 0.05, lng + 0.05]];

        const res = await fetch('/gptjson.aspx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lat, lng, latMin: b[0][0], lonMin: b[0][1], latMax: b[1][0], lonMax: b[1][1],
                checkIn: datePicker?.selectedDates[0]?.toISOString(),
                checkOut: datePicker?.selectedDates[1]?.toISOString(),
                adults: App.state.guests.adults,
                page: App.state.pagination.current,
                maxPrice: document.getElementById('p-rng-modal')?.value,
                types: Array.from(document.querySelectorAll('.t-f:checked')).map(cb => cb.value)
            })
        });
        
        const data = await res.json();
        const rawHotels = data.hotels || [];

        if (rawHotels.length === 0) {
            handleEmptyResults(isNextPage);
        } else {
            const parsed = rawHotels.map(h => ({
                ...h, id: h.id || h.hotel_name.replace(/\W/g, ''),
                price: parseFloat(h.price), lat: parseFloat(h.latitude || h.lat), lon: parseFloat(h.longitude || h.lon)
            }));
            App.state.hotels = isNextPage ? [...App.state.hotels, ...parsed] : parsed;
            App.state.pagination.allLoaded = false;

            updateH1(rawHotels[0].count, App.utils.getCityIn(rawHotels[0].city));
          //  MapModule.updateSearchMark(rawHotels[0].latitude + 0.03, rawHotels[0].longitude + 0.03, rawHotels[0].city)
            renderPagination(Math.ceil(rawHotels[0].count /20 )); // Предположим 10 на страницу
            render(isNextPage);
        }
    } catch (e) { console.error("Fetch Error:", e); }
    finally { stopLoader(); App.state.pagination.isFetching = false; }
}







/**
 * РЕНДЕРИНГ ИНТЕРФЕЙСА
 */
const renderedIds = new Set();
function render(isNextPage = false) {
    const grid = document.getElementById('grid');
    if (!grid) return;

    if (!isNextPage) {
        grid.innerHTML = '';
        renderedIds.clear();
        App.state.map.clusterer?.removeAll();
        App.state.map.marks = {};
    }

    const newHotels = App.state.hotels.filter(h => !renderedIds.has(h.id));
    const layout = ymaps.templateLayoutFactory.createClass(`<div id="mark-$[properties.hotelId]" class="map-price-tag" style="cursor: pointer;z-index:9999">$[properties.iconContent]</div>`);

    const html = newHotels.map(h => {
        renderedIds.add(h.id);

        const mark = new ymaps.Placemark([h.lat, h.lon], {
            iconContent: h.price.toLocaleString() + ' ₽',
            hotelId: h.id,
            balloonContent: MapModule.createBalloonContent(h)
        }, {
            iconLayout: 'default#imageWithContent',
            iconContentLayout: layout,
            iconImageSize: [0, 0],
            iconContentOffset: [-25, -15],
            hasBalloon: true,      // Принудительно разрешить балун для кастомного макета
            cursor: 'pointer',     // Установить курсор для всей области метки

            // --- ДОБАВИТЬ ЭТУ СТРОКУ ---
            cursor: 'pointer',
            iconShape:
            {
                type: 'Rectangle',
                coordinates: [
                    [-30, -
                        30],
                    [54, 10]
                ]
            },
            balloonPanelMaxMapArea: 0,
            hideIconOnBalloonOpen: false,
            balloonOffset: [0, -20],
            balloonAutoPan: false,
            interactivityModel: 'default#transparent',
            // НАСТРОЙКИ СМЕЩЕНИЯ:
            balloonAutoPan: true,           // Разрешаем встроенное центрирование
            balloonAutoPanDuration: 400,    // Длительность анимации в мс
            balloonAutoPanMargin: 80       // Отступ от краев карты (чтобы балун не прилипал к верху)
        });

        // 1. ОТКРЫТИЕ ПРИ НАВЕДЕНИИ
        mark.events.add('click', (e) => {
            const target = e.get('target');
            target.options.set('zIndex', 1000);

            // Проверяем, что балун готов к открытию
            if (target.balloon) {
                target.balloon.open();
            }
        });

        // ОБРАБОТЧИК ДЛЯ БЛОКИРОВКИ ОБНОВЛЕНИЯ СПИСКА
        mark.events.add('balloonopen', () => {
            App.state.map.isMoving = true; // Блокируем loadHotels

            // Снимаем блокировку после завершения анимации (400мс + запас)
            setTimeout(() => {
                App.state.map.isMoving = false;
            }, 600);
        });

        //// 2. ЗАКРЫТИЕ ПРИ УВОДЕ (с проверкой, не на балуне ли мышь)
        //mark.events.add('mouseleave', (e) => {
        //    e.get('target').options.set('zIndex', 1);
        //    // Если хотите, чтобы балун закрывался сам:
        //    // e.get('target').balloon.close(); 
        //});

        // 3. ОТКРЫТИЕ ПАНЕЛИ ПО КЛИКУ НА МЕТКУ
        //mark.events.add('click', (e) => {
        //    openHotelDetail(h.id);
        //});

        App.state.map.marks[h.id] = mark;

        // Добавляем метку в кластеризатор (если он используется)
        if (App.state.map.clusterer) {
            App.state.map.clusterer.add(mark);
        } else {
            App.state.map.instance.geoObjects.add(mark);
        }

        return UIComponents.hotelCard(h);
    }).join('');

    grid.insertAdjacentHTML('beforeend', html);

    const marksArray = newHotels.map(h => App.state.map.marks[h.id]);
    if (App.state.hotels.length > 5) App.state.map.clusterer.add(marksArray);
    else marksArray.forEach(m => App.state.map.instance.geoObjects.add(m));
}

const renderStars = (count) => {
    const n = parseInt(count) || 0;
    if (n === 0) return '';
    return `<span class="card-stars">${'★'.repeat(Math.min(n, 5))}</span>`;
};

const UIComponents = {
    hotelCard: (h) => {
        const hotelCity = h.city || h.city_name || 'Москва';
        const hotelStars = renderStars(h.stars || h.hotel_stars);
        const nights = typeof getNightsCount === 'function' ? getNightsCount() : 1;

        return `
        <div class="hotel-card" id="card-${h.id}" onclick="openHotelDetail('${h.id}')" 
             onmouseenter="MapModule.highlightMark('${h.id}', true)" 
             onmouseleave="MapModule.highlightMark('${h.id}', false)">
            
            <div class="card-image-wrapper">
                <img src="${h.images || 'https://www.hotel24.ru'}" loading="lazy" alt="${h.hotel_name}">
                ${h.rating >= 4.8 ? `<div class="card-badge-top">Выбор гостей</div>` : ''}
            </div>

            <div class="card-body">
                <div class="card-header-row">
                    <div class="card-type-stars">
                        <span class="card-type">${h.type_hotel || 'Отель'}</span>
                        ${hotelStars}
                    </div>
                    <div class="card-rating-box">
                        <span class="rating-val">★ ${h.rating || '5.0'}</span>
                    </div>
                </div>

                <h3 class="card-title">${h.hotel_name}</h3>
                
                <div class="card-location-row">
                    <span class="card-city">${hotelCity}</span>
                    <span class="card-dist">📍 ${h.dist || '0.5'} км от центра</span>
                </div>

                <div class="card-footer">
                    <div class="card-price-container">
                        <div class="card-price-main">${h.price.toLocaleString()} ₽</div>
                        <div class="card-price-sub">за ${nights} ${typeof getNightsText === 'function' ? getNightsText(nights) : 'ночь'}</div>
                    </div>
                    <button class="btn-select-hotel">Выбрать</button>
                </div>
            </div>
        </div>`;
    }
};

const LoaderModule = {
    showSkeletons: () => {
        const grid = document.getElementById('grid');
        if (grid) grid.innerHTML = Array(8).fill('<div class="skeleton-card"></div>').join('');
    }

 

};




LoaderModule.showSkeletons = function (count = 8) {
    const grid = document.getElementById('grid');
    if (!grid) return;

    const skeletonHTML = Array(count).fill(`
          <div class="skeleton-card">
            <!-- Левая часть: Фото -->
            <div class="skeleton skeleton-image"></div>
            
            <!-- Правая часть: Тексты и кнопка -->
            <div class="skeleton-info">
                <div class="skeleton-header">
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text short"></div>
                </div>
                <div class="skeleton-footer">
                    <div class="skeleton skeleton-price"></div>
                    <div class="skeleton skeleton-btn"></div>
                </div>
            </div>
        </div>
    `).join('');

    grid.innerHTML = skeletonHTML;
};


 

window.changePage = (p) => {
    if (p < 1 || p === '...') return;
    App.state.pagination.current = p;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadHotels();
};

window.syncStateToURL = () => {
    const url = new URL(window.location);
    const p = url.searchParams;
    if (App.state.map.instance) {
        const c = App.state.map.instance.getCenter();
        p.set('lat', c[0].toFixed(6)); p.set('lng', c[1].toFixed(6)); p.set('place', App.state.place); p.set('z', App.state.map.instance.getZoom());
    }
    p.set('adults', App.state.guests.adults);
    p.set('kids', App.state.guests.kids);

    // 2. Даты (из Flatpickr)
    if (datePicker && datePicker.selectedDates.length > 0) {
        // Функция-помощник для форматирования без сдвига поясов
        const format = (date) => datePicker.formatDate(date, "Y-m-d");

        App.state.checkIn = format(datePicker.selectedDates[0])
        App.state.checkOut = format(datePicker.selectedDates[1])
        p.set('checkIn', format(datePicker.selectedDates[0]));

        if (datePicker.selectedDates[1]) {
            p.set('checkOut', format(datePicker.selectedDates[1]));
        }
    }

  
     
    if (App.state.pagination.current) p.set('page', App.state.pagination.current);

    window.history.replaceState({}, '', url);

};



/**
 * МОДУЛЬ НАВИГАЦИИ (ПАГИНАЦИЯ)
 */
const Navigation = {
    /**
     * Смена страницы
     * @param {number|string} page - Номер страницы или 'next'/'prev'
     */
    changePage(page) {
        // 1. Защита от некорректных значений и повторных кликов
        if (page === '...' || page === App.state.pagination.current) return;
        
        let targetPage = page;
        if (page === 'prev') targetPage = App.state.pagination.current - 1;
        if (page === 'next') targetPage = App.state.pagination.current + 1;

        if (targetPage < 1) return;

        // 2. Обновляем глобальное состояние
        App.state.pagination.current = targetPage;

        // 3. Плавный скролл к началу списка (чтобы юзер не остался внизу)
        const scrollTarget = document.getElementById('main-scroll') || window;
        scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });

        // 4. Запускаем загрузку данных для новой страницы
        // Передаем isNextPage = false, чтобы сетка очистилась полностью
        if (typeof loadHotels === 'function') {
            loadHotels(null, null, false);
        }

        // 5. Синхронизируем URL, чтобы при обновлении страницы остаться на этой же странице
        if (typeof syncStateToURL === 'function') {
            syncStateToURL();
        }
    }
};

// Экспорт для onclick в HTML
window.changePage = (p) => Navigation.changePage(p);

 
function startLoader() { document.getElementById('top-loader')?.classList.add('loading'); }
function stopLoader() { document.getElementById('top-loader')?.classList.remove('loading'); }

  

/**
 * УПРАВЛЕНИЕ ПОДЛОЖКОЙ (BACKDROP)
 */
const SearchOverlay = {
    get backdrop() { return document.getElementById('search-backdrop'); },

    open() {
        if (!this.backdrop) return;
        this.backdrop.classList.remove('hidden');
        // Блокируем скролл страницы, чтобы карта не дергалась под поиском
        document.body.style.overflow = 'hidden';
    },

    close() {
         
        if (!this.backdrop) return;
        this.backdrop.classList.add('hidden');
        document.body.style.overflow = '';

        // Закрываем все активные элементы поиска
        document.getElementById('ac-results')?.classList.add('hidden');
        document.getElementById('ac-results-mob')?.classList.add('hidden');
        document.getElementById('guests-dropdown')?.classList.add('hidden');
        document.querySelectorAll('.search-segment').forEach(s => s.classList.remove('is-active'));

        if (window.datePicker) window.datePicker.close();
    },

    init() {
        // Инициализация клика по подложке (закрывает всё тихо)
        this.backdrop?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
    }
};

// Запускаем инициализацию один раз
SearchOverlay.init();



window.handleInputFocus = (id) => {
    const input = document.getElementById(id);
    if (!input) return;

    // 1. Показываем подложку (блокируем карту/список)
    SearchOverlay.open();

    // 2. Логика Airbnb: запоминаем старое и очищаем
    input.dataset.oldValue = input.value;
    input.value = '';

    // 3. Подсвечиваем активный сегмент
    input.closest('.search-segment')?.classList.add('is-active');

    // 4. Показываем быстрые подсказки
    const resultsId = (id === 'ac-input-mob') ? 'ac-results-mob' : 'ac-results';
    if (typeof AutocompleteModule !== 'undefined') {
        AutocompleteModule.renderQuickList(resultsId);
    }
};





 
/**
 * АВТОКОМПЛИТ HOTEL24 (AIRBNB STYLE)
 * Срабатывание на весь search-segment
 */
const AutocompleteModule = {
    quickCities: ["Москва", "Санкт-Петербург", "Казань", "Сочи", "Екатеринбург"],

    setup(ids) {
        ids.forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;

            const segment = input.closest('.search-segment');
            const resultsId = (id === 'ac-input-mob') ? 'ac-results-mob' : 'ac-results';
            let debounceTimer;

            if (segment) {
                segment.addEventListener('click', (e) => {
                    if (typeof SearchOverlay !== 'undefined') SearchOverlay.open();
                    if (e.target.classList.contains('btn-clear')) return;
                    input.focus();
                });
            }

            input.addEventListener('focus', () => {
                input.dataset.oldValue = input.value;
                input.value = '';
                segment?.classList.add('is-active');
                const btnClear = segment?.querySelector('.btn-clear');
                if (btnClear) btnClear.classList.add('hidden');
                this.renderQuickList(resultsId);
            });

            input.addEventListener('input', function () {
                const query = this.value.trim();
                const btnClear = segment?.querySelector('.btn-clear');
                if (btnClear) btnClear.classList.toggle('hidden', query.length === 0);

                clearTimeout(debounceTimer);
                if (query.length < 2) {
                    AutocompleteModule.renderQuickList(resultsId);
                    return;
                }

                debounceTimer = setTimeout(() => {
                    if (typeof ymaps !== 'undefined' && ymaps.suggest) {
                        ymaps.suggest(query).then(items => {
                            AutocompleteModule.renderSearchList(items, resultsId);
                        });
                    }
                }, 300);
            });

            input.addEventListener('blur', () => {
                // Задержка важна, чтобы успел сработать onmousedown на подсказке
                setTimeout(() => {
                    if (input.value.trim() === '' && input.dataset.oldValue) {
                        input.value = input.dataset.oldValue;
                    }
                    segment?.classList.remove('is-active');
                    document.getElementById(resultsId)?.classList.add('hidden');
                }, 250);
            });
        });
    },

    renderQuickList(targetId) {
        const res = document.getElementById(targetId);
        if (!res) return;

        res.innerHTML = `
            <div class="ac-hotel24-header">ПОПУЛЯРНЫЕ НАПРАВЛЕНИЯ</div>
            <div class="ac-hotel24-grid">
                ${this.quickCities.map(city => `
                    <div class="ac-item-hotel24" onmousedown="handleSelect('${city}'); event.stopPropagation();">
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
                <div class="ac-item-hotel24" onmousedown="handleSelect('${safeVal}'); event.stopPropagation();">
                    <div class="ac-icon-wrap">🔍</div>
                    <span>${val}</span>
                </div>
            `;
        }).join('');
        res.classList.remove('hidden');
    }
};

window.setupAutocomplete = (ids) => AutocompleteModule.setup(ids);



/**
 * ИНИЦИАЛИЗАЦИЯ КАЛЕНДАРЯ
 */
function initDatePicker() {
    const isMobile = window.innerWidth < 1024;
    const deskContainer = document.getElementById('desk-date-trigger');
    const input = document.getElementById('desk-date-input');

    if (!input) return;

    const config = {
        mode: "range",
        locale: "ru",
        minDate: "today",
        dateFormat: "d M",
        defaultDate: App.state.dates,
        static: !isMobile,
        appendTo: isMobile ? document.body : deskContainer,
        closeOnSelect: true,

        onChange: (selectedDates, dateStr) => {
           
            // 1. Проверяем, что выбраны ОБЕ даты
            if (selectedDates.length < 2) return;
            SearchOverlay.close();
            const displayStr = dateStr ? dateStr.replace(" — ", " – ") : "Добавить даты";

            // 2. Обновляем текст в кнопках (всегда)
            App.updateUIElements(['desk-date-display', 'mob-date-display'], displayStr);

            // 3. ЛОГИКА ОБНОВЛЕНИЯ:
            // Если это МОБИЛКА — только обновляем UI и URL, но НЕ вызываем loadHotels
            // Если это ДЕСКТОП — вызываем загрузку сразу
            if (isMobile) {
                console.log("Mobile mode: dates updated, waiting for Search button click");
                if (typeof syncStateToURL === 'function') syncStateToURL();
            } else {
                App.state.pagination.current = 1;
                if (typeof loadHotels === 'function') loadHotels();
                if (typeof syncStateToURL === 'function') syncStateToURL();
            }
        },

        onOpen: () => SearchOverlay.open(),
        //onClose: (selectedDates, dateStr) => {
        //    // Если закрыли кликом мимо (не закончив выбор), просто закрываем оверлей
        //    if (selectedDates.length < 2) 
        //},

        //onChange: (selectedDates) => {
        //    // Сработает сразу, как только пользователь кликнет по второй дате в календаре
        //    if (selectedDates.length === 2 && window.innerWidth >= 1024) {
        //        App.state.pagination.current = 1;
        //        SearchOverlay.close();
        //        loadHotels();
        //    }
        //}


    };

  

    datePicker = flatpickr(input, config);

    // Обработчики открытия
    document.getElementById('desk-date-trigger')?.addEventListener('click', () => datePicker.open());
    document.getElementById('mob-date-display')?.addEventListener('click', (e) => {
        e.stopPropagation();
        datePicker.open();
    });
}

function updateH1(count, cityName = "выбранном месте") {
    const countEl = document.getElementById('res-count-v2');
    const locEl = document.getElementById('h1-location');
    const brCity = document.getElementById('br-city');

    // 1. Обновляем число (например: "125")
    if (countEl) {
        countEl.innerText = (count && count > 0) ? count : 'Ищем..';
    }

    // 2. Обновляем город в H1 (например: "в Москве")
    if (locEl) {
        locEl.innerText = cityName;
    }

    // 3. Обновляем город в хлебных крошках
    if (brCity) {
        brCity.innerText = cityName;
    }

    // 4. Обновляем мобильную заглушку (если город изменился)
    const stubTitle = document.querySelector('.search-stub b');
    if (stubTitle) {
        // Убираем "в ", если оно есть для заголовка, чтобы в поиске было просто "Москва"
        stubTitle.innerText = cityName.replace(/^в\s+/i, '');
    }
}




/**
 * РЕНДЕРИНГ ПАГИНАЦИИ (КНОПКИ СТРАНИЦ)
 */
function renderPagination(totalPages) {
    const container = document.getElementById('pagination-container');
    if (!container) return;

    // Если всего 1 страница или меньше — скрываем блок
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const current = App.state.pagination.current;
    const delta = 1; // Сколько страниц показывать вокруг текущей
    let pages = [];

    // Алгоритм формирования массива страниц (1 ... 4 5 6 ... 10)
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= current - delta && i <= current + delta)) {
            pages.push(i);
        } else if (pages[pages.length - 1] !== '...') {
            pages.push('...');
        }
    }

    // Генерация HTML
    let html = '';

    // Кнопка "Назад"
    html += `<button class="pg-btn" ${current === 1 ? 'disabled' : ''} onclick="changePage(${current - 1})">＜</button>`;

    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="pg-dots">...</span>`;
        } else {
            const activeClass = p === current ? 'active' : '';
            html += `<button class="pg-btn ${activeClass}" onclick="changePage(${p})">${p}</button>`;
        }
    });

    // Кнопка "Вперед"
    html += `<button class="pg-btn" ${current === totalPages ? 'disabled' : ''} onclick="changePage(${current + 1})">＞</button>`;

    container.innerHTML = html;
}

 



/**
 * ИСПРАВЛЕННЫЙ ГЛОБАЛЬНЫЙ МОСТ (БЕЗ РЕКУРСИИ)
 */

// 1. Гости (Исправляем бесконечный цикл)
window.changeG = (context, delta, type) => {
    // Вызываем метод объекта, а не саму функцию changeG
    if (typeof GuestManager !== 'undefined') {
        GuestManager.change(context, delta, type);
    }
};

// 2. Фильтры
window.openFilters = () => FiltersModule.open();
window.closeFilters = () => FiltersModule.close();
window.applyFilters = () => FiltersModule.apply();
window.clearAllFilters = () => FiltersModule.clearAll();
window.updatePriceModal = (val) => FiltersModule.updatePriceDisplay(val);


window.handleSelect = async function (address) {
    if (!address) return;
    console.log("Mobile Select Triggered:", address);

    // СРАЗУ записываем значение во все инпуты и обновляем их внутреннее состояние
    ['ac-input-desk', 'ac-input-mob'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = address;
            el.dataset.oldValue = address; // КРИТИЧНО: предотвращаем откат при потере фокуса
            el.blur(); // Закрываем мобильную клавиатуру
        }
    });

    // Закрываем оверлеи и результаты
    if (typeof SearchOverlay !== 'undefined') SearchOverlay.close();
    if (typeof closeMobSearch === 'function') closeMobSearch();

    document.getElementById('ac-results')?.classList.add('hidden');
    document.getElementById('ac-results-mob')?.classList.add('hidden');

    const cityName = address.split(',')[0].trim();
    App.state.place = cityName;

    try {
        const res = await ymaps.geocode(address);
        const firstObj = res.geoObjects.get(0);
        if (!firstObj) return;

        const coords = firstObj.geometry.getCoordinates();
        App.state.map.isMoving = true;

        MapModule.updateSearchMark(coords[0], coords[1], cityName);
        if (typeof updateH1 === 'function') updateH1('Ищем...', App.utils.getCityIn(cityName));

        await App.state.map.instance.setCenter(coords, 14, { duration: 800 });

        App.state.map.isMoving = false;
        App.state.pagination.current = 1;

        loadHotels(coords[0], coords[1]);
        syncStateToURL();

    } catch (e) {
        console.error("Ошибка геокодирования:", e);
        App.state.map.isMoving = false;
    }
};

 


// 4. Пагинация
window.changePage = (p) => {
    if (typeof Navigation !== 'undefined') {
        Navigation.changePage(p);
    }
};

// 5. Мобильный поиск (простые обертки)
window.openMobSearch = (hotelName = "") => {
    const el = document.getElementById('mobOverlay');
    const input = document.getElementById('ac-input-mob');
    
    if (el) {
        el.classList.add('active');
        document.body.style.overflow = 'hidden';

        if (hotelName && input) {
            // 1. Устанавливаем значение в инпут
            input.value = hotelName;
            
            // 2. ВАЖНО: Обновляем значение в глобальном стейте, 
            // чтобы другие функции (например, sync или render) видели его
            if (App.state) App.state.place = hotelName; 

            // 3. Показываем кнопку очистки
            const clearBtn = input.parentElement.querySelector('.btn-clear');
            if (clearBtn) clearBtn.classList.remove('hidden');
        }

       // setTimeout(() => { if (input) input.focus(); }, 300);
    }
};

window.closeMobSearch = () => {
    SearchOverlay.close();
    const el = document.getElementById('mobOverlay');
    if (el) {
        el.classList.remove('active');
        document.body.style.overflow = '';
    }
};

/**
 * ЕДИНАЯ ТОЧКА ЗАПУСКА
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log("App initializing...");

    FiltersModule.init();

    // Инициализируем стейт из URL
    const params = new URLSearchParams(window.location.search);
    if (params.has('adults')) App.state.guests.adults = parseInt(params.get('adults'));
    if (params.has('kids')) App.state.guests.kids = parseInt(params.get('kids'));

    const myurl_start = URLModule.parse();
   
    //console.log(startParams.dIn)
    // Запуск компонентов
    if (typeof initDatePicker === 'function')  initDatePicker();
    if (typeof setupAutocomplete === 'function')  setupAutocomplete(['ac-input-desk', 'ac-input-mob']);

    // Отрисовка гостей в UI при старте
    if (typeof GuestManager !== 'undefined')
    GuestManager.syncUI();
    GuestUI.init();

    const sc = JSON.parse(document.getElementById('start-coords')?.textContent || '{}');
 

    const lat = parseFloat(params.get('lat')) || sc.lat;
    const lng = parseFloat(params.get('lng')) || sc.lng;
    const city = params.get('place') || sc['main-place'];

    MapModule.load(lat, lng, city);
     
});




/**
* МОДУЛЬ ФИЛЬТРАЦИИ (ЦЕНА И ТИПЫ ЖИЛЬЯ)
*/
const FiltersModule = {
    config: {
        maxPriceDefault: 150000,
        containerId: 'type-filters-modal',
        modalId: 'filter-modal'
    },

    // Инициализация (вызвать один раз при старте приложения)
    init() {
        const modal = document.getElementById(this.config.modalId);
        if (!modal) return;

        // Закрытие при клике на темную область (оверлей)
        modal.addEventListener('click', (e) => {
            // Если кликнули именно по подложке, а не по контенту внутри
            if (e.target === modal) {
                this.close();
            }
        });
    },

    open() {
        const modal = document.getElementById(this.config.modalId);
        if (modal) {
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            this.renderTypeCheckboxes();
            this.updatePriceDisplay(document.getElementById('p-rng-modal')?.value || this.config.maxPriceDefault);
        }
    },

    close() {
        document.getElementById(this.config.modalId)?.classList.add('hidden');
        document.body.style.overflow = '';
    },

    // 3. Динамическая генерация чекбоксов на основе ТЕКУЩИХ отелей
    renderTypeCheckboxes() {
        const container = document.getElementById(this.config.containerId);
        if (!container) return;

        // Берем типы из всех загруженных отелей (App.state.hotels)
        const allTypes = App.state.hotels.map(h => h.type_hotel || 'Отель');
        const uniqueTypes = [...new Set(allTypes)].filter(Boolean);

        if (uniqueTypes.length === 0) {
            container.innerHTML = '<p style="color:gray; font-size:13px; padding:10px;">Типы жилья загружаются...</p>';
            return;
        }

        container.innerHTML = uniqueTypes.map(type => `
            <label class="type-item-v2" style="display:flex; justify-content:space-between; align-items:center; padding:10px; cursor:pointer; border-bottom:1px solid #f5f5f5;">
                <span style="font-size:14px;">${type}</span>
                <input type="checkbox" class="t-f" value="${type}" checked style="width:18px; height:18px;">
            </label>
        `).join('');
    },

    // 4. Обновление текста цены (в модалке и в хедере)
    updatePriceDisplay(val) {
        const formatted = Number(val).toLocaleString('ru-RU') + ' ₽';
        // Обновляем в модалке
        App.updateUIElements(['p-txt-modal'], formatted);
        // Обновляем информер в хедере (если есть)
        App.updateUIElements(['p-txt-desktop'], `до ${formatted}`);
    },

    // 5. ПРИМЕНЕНИЕ ФИЛЬТРОВ (Запрос к серверу)
    apply() {
        this.close();

        // Сбрасываем пагинацию на первую страницу
        App.state.pagination.current = 1;
        App.state.pagination.allLoaded = false;

        // Вызываем основную функцию загрузки
        // Она сама считает значения из #p-rng-modal и .t-f:checked
        if (typeof loadHotels === 'function') {
            loadHotels(null, null, false);
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Синхронизируем URL, чтобы фильтры не пропали при обновлении
        if (typeof syncStateToURL === 'function') syncStateToURL();
    },

    // 6. ПОЛНЫЙ СБРОС
    clearAll() {
        // Сброс ползунка цены
        const range = document.getElementById('p-rng-modal');
        if (range) {
            range.value = this.config.maxPriceDefault;
            this.updatePriceDisplay(this.config.maxPriceDefault);
        }

        // Сброс чекбоксов (отмечаем все)
        document.querySelectorAll('.t-f').forEach(cb => cb.checked = true);

        // Применяем пустые фильтры
        this.apply();
    }




};



/**
 * МОДУЛЬ УПРАВЛЕНИЯ ВЫПАДАЮЩИМ СПИСКОМ ГОСТЕЙ
 */
const GuestUI = {
    // Названия элементов
    ids: {
        trigger: 'guests-trigger',
        dropdown: 'guests-dropdown',
        display: 'guests-display' // или 'desk-guests-display'
    },

    init() {
        const trigger = document.getElementById(this.ids.trigger);
        const dropdown = document.getElementById(this.ids.dropdown);

        if (!trigger || !dropdown) return;

        // 1. Открытие/закрытие по клику на кнопку "Кто едет"
        trigger.addEventListener('click', (e) => {
            SearchOverlay.open();
            e.stopPropagation();
            const isHidden = dropdown.classList.toggle('hidden');

            // Если открыли — подсвечиваем кнопку (опционально)
            trigger.classList.toggle('active', !isHidden);
        });

        // 2. Остановка всплытия клика внутри меню 
        // (чтобы клик по + или - не закрывал всё меню)
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 3. Закрытие при клике в любом месте страницы
        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
            trigger.classList.remove('active');
        });

        // Сразу синхронизируем текст при загрузке
        this.updateTriggerText();
    },

    // Обновляет текст на самой кнопке (например, "3 гостя")
    updateTriggerText() {
        const { adults, kids } = App.state.guests;
        const total = adults + kids;
        const text = `${total} ${GuestManager.getTerm(total)}`;

        // Обновляем десктопный и мобильный дисплеи
        App.updateUIElements(['desk-guests-display', 'mob-guests-display'], text);

        // Обновляем заглушку в мобильном поиске (Stub)
        const stub = document.getElementById('mob-stub-info');
        if (stub) {
            const dates = App.state.dateRangeText || "Когда угодно";
            stub.innerText = `${dates} • ${text}`;
        }
    }
};

 










const GuestManager = {
    // Склонение слова "гость" (1 гость, 2 гостя, 5 гостей)
    getTerm(n) {
        let cases = [2, 0, 1, 1, 1, 2];
        let titles = ['гость', 'гостя', 'гостей'];
        return titles[(n % 100 > 4 && n % 100 < 20) ? 2 : cases[(n % 10 < 5) ? n % 10 : 5]];
    },

    // Главная функция: вызывается при клике на кнопки + и -
    change(context, delta, type) {
        const isAdult = type === 'adults';
        const currentVal = App.state.guests[type] || (isAdult ? 2 : 0);
        const min = isAdult ? 1 : 0; // Минимум 1 взрослый

        // 1. Обновляем данные в центральном стейте
        App.state.guests[type] = Math.max(min, currentVal + delta);

        // 2. Синхронизируем все цифры в интерфейсе
        this.syncUI();

        // 3. Перезагружаем список отелей с новыми параметрами
        App.state.pagination.current = 1;
      //  loadHotels();

        // 4. Обновляем URL (чтобы при обновлении страницы гости сохранились)
        if (typeof syncStateToURL === 'function') syncStateToURL();
    },


    //************ОТРИСОВКА строки поиска*/
    // Обновляет все надписи "X гостей" на странице
    syncUI() {
        const { adults, kids } = App.state.guests;
        const total = adults + kids;
        const guestText = `${total} ${this.getTerm(total)}`;

        // Обновляем счетчики внутри выпадающих списков (desk и mob)
        ['desk', 'mob'].forEach(ctx => {
            App.updateUIElements([`cnt-${ctx}-adults`], adults);
            App.updateUIElements([`cnt-${ctx}-kids`], kids);
            App.updateUIElements([`${ctx}-guests-display`], guestText);
        });

        // Обновляем мобильную серую плашку (Stub)
        const stubInfo = document.getElementById('mob-stub-info');
        if (stubInfo) {
            const datePart = App.state.dateRangeText || "Когда угодно";
            stubInfo.innerText = `${datePart} • ${guestText}`;
        }

        // 2. ДАТЫ (Исправляем "Добавить даты")
        // Берем текст из стейта (который наполнил parse())
        const dateText = App.state.dateRangeText;
        if (dateText) {
                App.updateUIElements(['desk-date-display', 'mob-date-display'], dateText);
        }
        
        const currentCity = App.state.place
        if (currentCity) {
            App.updateUIElements(['ac-input-desk', 'ac-input-mob'], currentCity);
        }


    }
};

 

// Функция для обновления текста (если вызывается отдельно)
window.updateGuestsDisplay = () => GuestManager.syncUI();

  


/**
* МОДУЛЬ ОБРАБОТКИ ОТСУТСТВИЯ РЕЗУЛЬТАТОВ
*/
const RenderModule = {
    // ... ваш метод render ...

    handleEmpty(isNextPage = false) {
        // 1. Если это догрузка (бесконечный скролл), просто ставим флаг "всё загружено"
        if (isNextPage) {
            App.state.pagination.allLoaded = true;
            return;
        }

        // 2. Если это основной поиск (первая страница) — ПОЛНЫЙ СБРОС
        App.state.hotels = [];

        // Очищаем карту через MapModule
        if (window.MapModule) {
            MapModule.clusterer?.removeAll();
            MapModule.marks = {};
        }

        // Очищаем пагинацию
        const paginContainer = document.getElementById('pagination-container');
        if (paginContainer) paginContainer.innerHTML = '';

        // 3. Рендерим заглушку в сетку
        const grid = document.getElementById('grid');
        if (grid) {
            grid.innerHTML = `
                <div class="no-results-wrapper">
                    <div class="no-results-icon">🔍</div>
                    <h2>Ничего не нашли</h2>
                    <p>Попробуйте изменить даты, уменьшить количество гостей или сбросить фильтры.</p>
                    <button class="btn-reset-filters" onclick="FiltersModule.clearAll()">
                        Очистить все фильтры
                    </button>
                </div>
            `;
        }

        console.log("[Render] Empty results handled");
    }
};

// Экспорт для функции loadHotels
window.handleEmptyResults = (isNextPage) => RenderModule.handleEmpty(isNextPage);



/**
* МОДУЛЬ ПОИСКА И АВТОКОМПЛИТА (SEARCH UI)
*/
const SearchUI = {
   
     
    clear(id) {
        const input = document.getElementById(id);
        if (!input) return;

        input.value = '';
        input.focus();

        clearTimeout(this.debounceTimer);

        const btnClear = input.parentElement.querySelector('.btn-clear');
        if (btnClear) btnClear.classList.add('hidden');

        const resultsId = (id === 'ac-input-mob') ? 'ac-results-mob' : 'ac-results';
        //this._hideResults(resultsId);

        // Сброс заголовков в стейте и UI
        const stubTitle = document.querySelector('.search-stub b');
        if (stubTitle) stubTitle.innerText = "Куда едем?";
    }

     
};
 

// Экспорты
window.clearInput = (id) => SearchUI.clear(id);
 




SearchUI.toggleMobileView = function () {
    const body = document.body;
    const btnText = document.getElementById('map-btn-text');

    // 1. Переключаем класс видимости карты
    const isMapShown = body.classList.toggle('show-map');

    // 2. Обновляем текст на плавающей кнопке
    if (btnText) {
        btnText.innerText = isMapShown ? "Список" : "Карта";
    }

    // 3. КРИТИЧНО: Если карта показана, обновляем её вьюпорт
    // Без этого Яндекс.Карта может отобразиться некорректно (смещенный центр или серые зоны)
    if (isMapShown && MapModule.instance) {
        // Даем браузеру 50мс на отрисовку контейнера, затем ресайзим карту
        setTimeout(() => {
            MapModule.instance.container.fitToViewport();
        }, 50);
    }

    console.log(`[UI] Mobile view changed: ${isMapShown ? 'Map' : 'List'}`);
};

 window.toggleMobileMap = () => SearchUI.toggleMobileView();


 
/**
 * МОДУЛЬ РАБОТЫ С URL
 * Отвечает за чтение параметров при загрузке и первичную настройку стейта.
 */
const URLModule = {
    /**
     * 1. Парсинг параметров URL в App.state
     */
    parse() {
        const params = new URLSearchParams(window.location.search);
        const scEl = document.getElementById('start-coords');
        const sc = JSON.parse(scEl?.textContent || '{}');


        // Внутри URLModule.parse()
        const dIn = params.get('checkIn');
        const dOut = params.get('checkOut');
        const dplace = params.get('place');
        if (dIn && dOut) {
            App.state.dates = [new Date(dIn), new Date(dOut)];
            const txtIn = App.utils.formatUrlDate(dIn);
            const txtOut = App.utils.formatUrlDate(dOut);
            // СОХРАНЯЕМ В СТЕЙТ
            App.state.dateRangeText = `${txtIn} – ${txtOut}`;
        } else {
            // ДЕФОЛТ (завтра - послезавтра), если в URL пусто
            const d1 = new Date(); d1.setDate(d1.getDate() + 1);
            const d2 = new Date(); d2.setDate(d2.getDate() + 2);
            App.state.dates = [d1, d2];
            App.state.dateRangeText = `${App.utils.formatUrlDate(d1)} – ${App.utils.formatUrlDate(d2)}`;
        }

        //--place
        if (dplace) {
             
            App.state.place = dplace;

        }

        else  
        {

            App.state.place = sc['main-place']

        }


        // --- ГЕО-ДАННЫЕ ---
        //const lat = parseFloat(params.get('lat')) || parseFloat(sc.lat) || 55.7558;
        //const lng = parseFloat(params.get('lng')) || parseFloat(sc.lng) || 37.6173;
        //const zoom = parseInt(params.get('z')) || 14;

        place = App.state.place 
      
        // --- ГОСТИ ---
        if (params.has('adults')) App.state.guests.adults = parseInt(params.get('adults'));
        if (params.has('kids')) App.state.guests.kids = parseInt(params.get('kids'));

        // --- ДАТЫ ---
        if (params.has('checkIn') && params.has('checkOut')) {
            const dIn = params.get('checkIn');
            const dOut = params.get('checkOut');
            App.state.dates = [new Date(dIn), new Date(dOut)];

            // Форматируем текст для отображения (например, "20 фев – 22 фев")
            const txtIn = App.utils.formatUrlDate(dIn);
            const txtOut = App.utils.formatUrlDate(dOut);
            if (txtIn && txtOut) {
                App.state.dateRangeText = `${txtIn} – ${txtOut}`;
            }
        }

        return {};
    }

}


function toggleMainMenu() {
    const menu = document.getElementById('mainMenuDropdown');
    menu.classList.toggle('hidden');

    // Закрытие при клике снаружи
    if (!menu.classList.contains('hidden')) {
        setTimeout(() => {
            document.addEventListener('click', function close(e) {
                if (!e.target.closest('.header-actions')) {
                    menu.classList.add('hidden');
                    document.removeEventListener('click', close);
                }
            }, { once: true });
        }, 10);
    }
}


function toggleHeaderBackButton(show, hotelName = "") {
    const container = document.getElementById('mobile-header-content');
    const title = document.querySelector('#mobile-header-content b');

    // Проверяем, есть ли уже кнопка
    let backBtn = document.getElementById('header-back-btn');

    if (show) {
        if (!backBtn) {
            backBtn = document.createElement('button');
            backBtn.id = 'header-back-btn';
            backBtn.className = 'btn-header-back';
            backBtn.innerHTML = `
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
            `;
            backBtn.onclick = (e) => {
                e.stopPropagation();
                closeHotelDetail();
            };
            // Вставляем в самое начало (слева)
            container.prepend(backBtn);
        }
        if (title) title.innerText = hotelName;
    } else {
        if (backBtn) backBtn.remove();
        if (title) title.innerText = "Куда едем?";
    }
}
