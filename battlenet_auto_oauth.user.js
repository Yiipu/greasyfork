// ==UserScript==
// @name         战网自动填充在线版令牌
// @namespace    https://github.com/Yiipu
// @version      0.0.2
// @description  自动填充令牌。
// @author       Yiipu
// @match        https://oauth.g.mkey.163.com/oauth-front/two-step-verification*
// @grant        GM_xmlhttpRequest
// @license      GPL3
// @updateURL    https://raw.githubusercontent.com/Yiipu/greasyfork/main/battlenet_auto_oauth.user.js
// @downloadURL  https://raw.githubusercontent.com/Yiipu/greasyfork/main/battlenet_auto_oauth.user.js
// ==/UserScript==

const services = {
    "http://wy.wyq5.top/api/api_query": {
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data: (token) => {
            return "token=" + encodeURIComponent(token);
        },
        code: (resText) => {
            const res = JSON.parse(resText);
            if (res.code == 0) {
                return res.data;
            } else {
                console.error('Error fetching token:', resText);
            }
        }
    },
    "http://124.223.168.199:8080/token": {
        headers: {
            "Content-Type": "application/json"
        },
        data: (token) => {
            return JSON.stringify({ token });
        },
        code: (resText) => {
            return resText;
        }
    },
    default: {
        headers: {
            "Content-Type": "application/json"
        },
        data: (token) => {
            return JSON.stringify({ token });
        },
        code: (resText) => {
            return resText;
        }
    }
};

(function () {
    'use strict';

    const btn = document.querySelector("#root > div > div._verification-btns_1kkll_20 > button:nth-child(2)");
    if (btn) btn.click();

    const curAccountStr = localStorage.getItem("BX_CURRENT_ACCOUNT");
    const curAccount = curAccountStr ? JSON.parse(curAccountStr).account : null;
    const accountMetaStr = curAccount ? localStorage.getItem(curAccount) : null;

    if (accountMetaStr) {
        const { endpoint, token } = JSON.parse(accountMetaStr);
        const service = services[endpoint] || services.default;

        GM_xmlhttpRequest({
            method: "POST",
            url: endpoint,
            headers: service.headers,
            data: service.data(token),
            onload: function (response) {
                try {
                    const code = JSON.parse(service.code(response.responseText));
                    console.log('Token sent successfully:', code);
                    const inputElement = document.querySelector("#root > div > div._mkey-code_1kkll_102 > input");
                    if (inputElement) {
                        inputElement.value = code;
                    }
                } catch (e) {
                    console.error('Failed to parse response:', e);
                }
            },
            onerror: function (error) {
                console.error('Error sending token:', error);
            }
        });
    } else {
        console.warn('No account meta found for current account:', curAccount);
    }
})();