---
description: Чистый девайс, регион, VPN/прокси и облачные телефоны перед заливом.
---

# Подготовка устройства

Базовая подготовка перед работой с источниками трафика. Цель — чистое устройство, корректный регион и безопасное сетевое окружение.

{% hint style="info" %}
SIM во время рабочего процесса лучше извлекать. Не давайте приложениям лишние разрешения (гео, контакты, микрофон — без необходимости).
{% endhint %}

## Платформы

{% tabs %}
{% tab title="iPhone (iOS)" %}
{% stepper %}
{% step %}
Извлеките SIM.
{% endstep %}

{% step %}
Выйдите из текущего iCloud и создайте новый аккаунт (регистрация на EU-номер).
{% endstep %}

{% step %}
Регион: **Settings → General → Language & Region → Region**.
{% endstep %}

{% step %}
Отключите геолокацию: **Settings → Privacy & Security → Location Services → Off**.
{% endstep %}

{% step %}
Сбросьте сеть: **Settings → General → Transfer or Reset iPhone → Reset → Reset Network Settings**.
{% endstep %}

{% step %}
При установке приложений не подтверждайте лишние доступы.
{% endstep %}
{% endstepper %}
{% endtab %}

{% tab title="Android" %}
{% stepper %}
{% step %}
Извлеките SIM и сбросьте устройство до заводских настроек.
{% endstep %}

{% step %}
При первом запуске выберите нужный **EU**-регион и часовой пояс.
{% endstep %}

{% step %}
Откажитесь от отправки данных и геолокации.
{% endstep %}

{% step %}
Создайте новый Google-аккаунт на EU-данные (или работайте без Play Market через APK).
{% endstep %}

{% step %}
Приложения ставьте под включённым VPN / Proxy.
{% endstep %}
{% endstepper %}
{% endtab %}

{% tab title="Memu" %}
Официальный сайт: [memuplay.com](https://www.memuplay.com)

1. Установите Multi-Memu (на дедике нужна виртуализация).
2. В настройках профиля выставьте производительность под ПК/дедик.
3. Root при необходимости отключите — меньше ошибок при установке APK.
4. Разрешение экрана — **мобильное**.
5. Оператор связи — под **ГЕО** пролива.
6. Подмените геопозицию ближе к региону трафика.
7. VPN/Proxy: Tun2Socks, SocksDroid, AdGuard, Windscribe и аналоги.

APK — через Play Market (EU-аккаунт) или напрямую.
{% endtab %}

{% tab title="GeeLark" %}
Сайт: [geelark.com](https://www.geelark.com/ru/)

GeeLark — **облачные Android-телефоны** с реальными аппаратными идентификаторами. Удобно для пула Instagram / TikTok / Snapchat.

1. Создайте профиль → назначьте **residential / mobile proxy**.
2. Автоподбор гео под IP прокси.
3. Установите нужные приложения.
4. Прогрейте аккаунты, затем заливайте контент.
5. Масштабируйте через шаблоны / синхронизатор (с живыми лимитами).

{% hint style="warning" %}
У облачных телефонов нет реальной SIM: SMS и звонки недоступны. Для SMS — внешние сервисы виртуальных номеров.
{% endhint %}
{% endtab %}
{% endtabs %}

## Чеклист перед стартом

* [ ] Регион и язык устройства совпадают с ГЕО
* [ ] Геолокация выключена / подменена осознанно
* [ ] VPN или прокси стабильны
* [ ] Аккаунты платформ не смешаны на одном «грязном» отпечатке

{% content-ref url="youtube.md" %}
[YouTube](youtube.md)
{% endcontent-ref %}

{% content-ref url="instagram.md" %}
[Instagram](instagram.md)
{% endcontent-ref %}

{% content-ref url="snapchat.md" %}
[Snapchat](snapchat.md)
{% endcontent-ref %}
