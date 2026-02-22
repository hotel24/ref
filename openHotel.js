/**
 * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
 */
const getNightsCount = () => {
    const dates = App.state.dates;
    if (!dates || dates.length < 2) return 1;
    const d1 = new Date(dates[0]);
    const d2 = new Date(dates[1]);
    const diff = d2 - d1;
    const nights = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return nights > 0 ? nights : 1;
};

const getNightsText = (n) => {
    const cases = [2, 0, 1, 1, 1, 2];
    const titles = ['ночь', 'ночи', 'ночей'];
    return titles[(n % 100 > 4 && n % 100 < 20) ? 2 : cases[(n % 10 < 5) ? n % 10 : 5]];
};

/**
 * ОТКРЫТИЕ ПАНЕЛИ ДЕТАЛЕЙ
 */
async function openHotelDetail(hotelId) {

    // СКРОЛЛ В НАЧАЛО ПАНЕЛИ (Добавить это)

    const h = App.state.hotels.find(item => String(item.id) === String(hotelId));
    if (!h) return;

     toggleHeaderBackButton(true, h.hotel_name);

    // --- СИНХРОНИЗАЦИЯ С URL ---
    const url = new URL(window.location);
    url.searchParams.set('hotel_id', hotelId);
    // pushState добавляет новую запись в историю, чтобы работала кнопка "Назад"
    window.history.pushState({ hotelId }, '', url);

    // Данные напрямую из h (без hotel_info)
    const hotelName = h.name || h.hotel_name || 'Отель';
    const hotelRating = h.ratings?.rating || h.rating || '5.0';
    const hotelAddress = h.location?.address || h.address || 'Адрес не указан';
    const hotelPrice = parseFloat(h.price || 0);
    const nights = getNightsCount();

    const panel = document.getElementById('hotel-detail-panel');
    const dynamicContainer = document.getElementById('hotel-detail-dynamic');
    document.body.style.overflow = 'hidden';

    const scrollContainer = panel.querySelector('.panel-inner-content');

    if (scrollContainer) {
        // Сбрасываем скролл мгновенно
        scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
    }

    // Фото: приоритет h.imgs, затем h.images, иначе заглушка
    const imgs = h.imgs || (h.images ? (Array.isArray(h.images) ? h.images : [h.images]) : ["https://www.hotel24.ru"]);
    const slidesHtml = imgs.map(src => `<div class="gallery-slide"><img src="${src}" loading="lazy"></div>`).join('');
    const dotsHtml = imgs.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}" onclick="goToSlide(${i})"></div>`).join('');

    // Удобства (Groups -> Amenities)
    const groups = h.amenities?.groups || [];
    const flatAmenities = groups.reduce((acc, group) => {
        if (group.amenities) group.amenities.forEach(item => item.name && acc.push(item.name));
        return acc;
    }, []);
    const uniqueAmenities = [...new Set(flatAmenities)].slice(0, 8);
    const amenitiesHtml = uniqueAmenities.map(name => `
        <div class="amenity-item"><span class="amenity-icon">✓</span><span class="amenity-name">${name}</span></div>
    `).join('');

    // Локация (Metro / Center)
    const locationFeatures = h.location_features || [];
    const metroHtml = locationFeatures.filter(item => item.type === 'METRO').slice(0, 3).map(metro => {
        const dist = metro.distance_meters > 1000 ? (metro.distance_meters / 1000).toFixed(1) + ' км' : metro.distance_meters + ' м';
        return `
            <div class="metro-item">
                <span class="metro-dot" style="background-color: ${metro.metro_line?.color || '#ccc'}"></span>
                <span class="metro-name">${metro.name}</span> <span class="metro-dist">${dist}</span>
            </div>`;
    }).join('');
    const centerInfo = locationFeatures.find(item => item.type === 'OTHER')?.name || '';

    const lat = h.location?.lat || h.lat;
    const lon = h.location?.lon || h.lon;

    dynamicContainer.innerHTML = `
        <div class="hotel-slideshow">
            <div class="slides-container" id="slidesContainer" onscroll="updateDots()">
                ${slidesHtml}
            </div>
            ${imgs.length > 1 ? `<div class="slides-dots">${dotsHtml}</div>` : ''}
            <button class="slide-nav prev" onclick="moveSlide(-1)">❮</button>
            <button class="slide-nav next" onclick="moveSlide(1)">❯</button>
        </div>

        <div class="panel-content-padding">
            <h1 class="hotel-name">${hotelName}</h1>
            <div class="hotel-meta">
                <span class="rating-badge">★ ${hotelRating}</span> · 
                <span class="address-text">📍 ${hotelAddress}</span>
            </div>
             
            ${metroHtml || centerInfo ? `
                <div class="location-brief">
                    <div class="metro-list">${metroHtml}</div>
                    ${centerInfo ? `<div class="center-dist">🏙️ ${centerInfo}</div>` : ''}
                </div>` : ''}

            ${uniqueAmenities.length > 0 ? `
                <div class="hotel-amenities-section">
                    <h3 class="section-title">Удобства в отеле</h3>
                    <div class="amenities-grid">${amenitiesHtml}</div>
                </div>` : ''}

            <div id="rooms-list-container">
                <div class="panel-loader">
                    ${[1, 2, 3].map(() => `
                        <div class="skeleton-room">
                            <div class="skeleton-img"></div>
                            <div class="skeleton-info">
                                <div class="skeleton-line title"></div>
                                <div class="skeleton-line text"></div>
                                <div class="skeleton-line last"></div>
                            </div>
                        </div>`).join('')}
                </div>
            </div>
            <div id="hotel-detail-map" class="hotel-detail-map"></div>
        </div>

        <div class="detail-sticky-footer">
            <div class="price-box">
                <div class="val">${Number(hotelPrice * nights).toLocaleString()} ₽</div>
                <div class="price-label">Итого за ${nights} ${getNightsText(nights)}</div>
            </div>
            <button class="btn-book-now" onclick="window.open('${h.url_ || '#'}', '_blank')">Забронировать</button>
        </div>
    `;

    panel.classList.remove('hidden');
    document.getElementById('hotel-detail-overlay').classList.remove('hidden');

    setTimeout(() => {
        if (scrollContainer) scrollContainer.scrollTop = 0;
        window.updateDots(); // Обновляем точки слайдера
    }, 10);

    // ИНИЦИАЛИЗАЦИЯ КАРТЫ ОТЕЛЯ
    if (lat && lon) {
        initHotelMap(lat, lon, hotelName);
    }

    // Внутри логики управления хедером:
    // --- ПРИВЯЗКА НАЗВАНИЯ К ПОИСКУ ---
    // --- ОБНОВЛЯЕМ ХЕДЕР ДЛЯ ЭТОГО ОТЕЛЯ ---
    const searchStub = document.querySelector('.search-stub');
    if (searchStub) {
        const hotelName = h.hotel_name || h.name || "Отель";

        // Перезаписываем клик: передаем имя в функцию
        searchStub.onclick = (e) => {
            e.stopPropagation();
            window.openMobSearch(hotelName);
        };

        // Визуально меняем текст в самой "пилюле"
        const titleB = searchStub.querySelector('b');
        if (titleB) titleB.innerText = hotelName;
    }

    setTimeout(() => window.updateDots(), 100);
    fetchHotelRooms(h);
}

/**
 * ЗАГРУЗКА НОМЕРОВ
 */
async function fetchHotelRooms(h) {
    const roomsContainer = document.getElementById('rooms-list-container');
    const nights = getNightsCount();
    const formatDate = (d) => new Date(d).toISOString().split('T')[0];

    const params = {
        "childrenAges": App.state.childrenAges || "",
        "adults": String(App.state.guests?.adults || "2"),
        "hotel_id": h.id,
        "checkinDate": App.state.dates ? formatDate(App.state.dates[0]) : formatDate(new Date()),
        "checkoutDate": App.state.dates ? formatDate(App.state.dates[1]) : formatDate(new Date(Date.now() + 86400000))
    };

    try {
        const response = await fetch('css_get_hotel_info.aspx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });

        const data = await response.json();
        if (!data.rooms || data.rooms.length === 0) {
            roomsContainer.innerHTML = '<p class="no-rooms-msg">Мест нет на выбранные даты.</p>';
            return;
        }

        roomsContainer.innerHTML = `
    <h3 class="rooms-title">Доступные номера</h3>
    ${data.rooms.map((room, roomIdx) => {
            const offer = room.offers?.[0] || null;
            const pricePerNight = offer?.price?.value || 0;
            const totalPrice = pricePerNight * nights;

            // Массив фото номера
            const roomImgs = room.images?.map(img => img.url_template.replace('%s', 'L')) || ['https://www.hotel24.ru'];

            // Уникальный ID для контейнера слайдов этого номера
            const sliderId = `room-slider-${roomIdx}`;

            return `
            <div class="room-card-v2">
                <div class="room-img-container">
                    <div class="room-slides" id="${sliderId}">
                        ${roomImgs.map(src => `<div class="room-slide"><img src="${src}" loading="lazy"></div>`).join('')}
                    </div>
                    ${roomImgs.length > 1 ? `
                        <button class="room-nav prev" onclick="moveRoomSlide('${sliderId}', -1)">❮</button>
                        <button class="room-nav next" onclick="moveRoomSlide('${sliderId}', 1)">❯</button>
                    ` : ''}
                </div>
                <div class="room-details">
                    <div class="room-header-flex">
                        <h4>${room.name}</h4>
                        <div class="room-price-val">${totalPrice.toLocaleString()} ₽</div>
                    </div>
                    <div class="room-meta">
                        📐 ${room.area?.value || '--'} м² · 🛏️ ${room.bed_groups?.[0]?.configuration?.[0]?.name_inflected_form || 'Номер'}
                    </div>
                    <div class="room-amenities-tags">
                        <span class="tag-meal">🍴 ${offer?.meal_type?.name || 'Без питания'}</span>
                        <span class="${offer?.cancellation?.refund_type === 'NON_REFUNDABLE' ? 'cancel-warn' : 'cancel-ok'}">
                            ${offer?.cancellation?.refund_type === 'NON_REFUNDABLE' ? 'Невозвратный' : 'Бесплатная отмена'}
                        </span>
                    </div>
                    <div class="room-footer-actions">
                        <span class="price-per-night">${pricePerNight.toLocaleString()} ₽ / ночь</span>
                        <button class="btn-room-select" onclick="window.open('${offer?.booking_url || h.url_}', '_blank')">Выбрать</button>
                    </div>
                </div>
            </div>`;
        }).join('')}`;
    } catch (err) {
        roomsContainer.innerHTML = '<p class="error-msg">Ошибка загрузки данных.</p>';
    }
}

/**
 * ГЛОБАЛЬНЫЕ ФУНКЦИИ СЛАЙДЕРА
 */
window.updateDots = function () {
    const el = document.getElementById('slidesContainer');
    const dots = document.querySelectorAll('.dot');
    if (el && dots.length) {
        const idx = Math.round(el.scrollLeft / el.offsetWidth);
        dots.forEach((dot, i) => dot.classList.toggle('active', i === idx));
    }
};

window.moveSlide = (dir) => {
    const el = document.getElementById('slidesContainer');
    if (el) el.scrollBy({ left: dir * el.offsetWidth, behavior: 'smooth' });
};

window.goToSlide = (idx) => {
    const el = document.getElementById('slidesContainer');
    if (el) el.scrollTo({ left: idx * el.offsetWidth, behavior: 'smooth' });
};

function closeHotelDetail() {
    toggleHeaderBackButton(false);
    const panel = document.getElementById('hotel-detail-panel');
    const overlay = document.getElementById('hotel-detail-overlay');

    // 1. Запускаем анимацию (убираем только визуально)
    if (panel) panel.classList.add('hidden');
    if (overlay) overlay.style.opacity = '0';

    // 2. Очищаем URL сразу
    const url = new URL(window.location);
    url.searchParams.delete('hotel_id');
    window.history.pushState({}, '', url.pathname + url.search);

    // 3. Ждем завершения анимации (400ms как в CSS), затем скрываем физически
    setTimeout(() => {
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.style.opacity = ''; // Сброс для следующего открытия
        }
        document.body.style.overflow = '';
    }, 400);


    const searchStub = document.querySelector('.search-stub');
    if (searchStub) {
        const params = new URLSearchParams(window.location.search);
        // Возвращаем стандартный поиск без аргументов
        searchStub.onclick = () => window.openMobSearch();

        const titleB = searchStub.querySelector('b');
        if (App.state) App.state.place = params.get('place') || 'Куда едете?';
        if (titleB) titleB.innerText = App.state.place;
         
    }
}
/**
 * ГЛОБАЛЬНОЕ УПРАВЛЕНИЕ СЛАЙДЕРАМИ НОМЕРОВ
 */
window.moveRoomSlide = function (sliderId, dir) {
    const el = document.getElementById(sliderId);
    if (el) {
        // Мы берем offsetWidth именно того контейнера, по которому кликнули
        el.scrollBy({
            left: dir * el.offsetWidth,
            behavior: 'smooth'
        });
    }
};


function initHotelMap(lat, lon, name) {
    // Ждем, пока Яндекс.Карты будут готовы
    ymaps.ready(() => {
        const mapContainer = document.getElementById('hotel-detail-map');
        if (!mapContainer) return;

        // Очищаем контейнер перед новой картой
        mapContainer.innerHTML = '';

        const hotelMap = new ymaps.Map("hotel-detail-map", {
            center: [lat, lon],
            zoom: 15,
            controls: ['zoomControl']
        }, {
            yandexMapDisablePoiInteractivity: true,
            suppressMapOpenBlock: true // Убираем лишние кнопки Яндекса
        });

        const placemark = new ymaps.Placemark([lat, lon], {
            balloonContent: name
        }, {
            preset: 'islands#redDotIcon'
        });

        hotelMap.geoObjects.add(placemark);

        // Фикс для корректного отображения внутри скрытых/динамических блоков
        hotelMap.container.fitToViewport();
    });
}


// Функция инициализации при загрузке страницы
function initHotelFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const hotelId = params.get('hotel_id');

    if (hotelId) {
        // Ждем появления отелей в стейте (особенно если они грузятся по AJAX)
        const checkHotelsInterval = setInterval(() => {
            if (App.state.hotels && App.state.hotels.length > 0) {
                // Если отель найден в загруженном списке — открываем его
                const hotelExists = App.state.hotels.some(h => String(h.id) === String(hotelId));
                if (hotelExists) {
                    openHotelDetail(hotelId);
                }
                clearInterval(checkHotelsInterval);
            }
        }, 100);

        // Тайм-аут поиска (5 секунд), чтобы не крутить цикл вечно
        setTimeout(() => clearInterval(checkHotelsInterval), 5000);
    }
}

// Запускаем проверку при событии Load
window.addEventListener('load', initHotelFromUrl);

window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const hotelId = params.get('hotel_id');

    if (hotelId) {
        openHotelDetail(hotelId);
    } else {
        // Если ID в URL пропал (нажали назад), закрываем панель без перезагрузки
        const panel = document.getElementById('hotel-detail-panel');
        if (panel && !panel.classList.contains('hidden')) {
            // Вызываем вашу функцию закрытия
            closeHotelDetail();
        }
    }
});
