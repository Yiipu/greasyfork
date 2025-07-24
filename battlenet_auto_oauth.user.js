// ==UserScript==
// @name         战网自动填充在线版令牌
// @namespace    https://github.com/Yiipu
// @version      0.0.1
// @description  自动填充令牌。
// @author       Yiipu
// @match        https://oauth.g.mkey.163.com/oauth-front/two-step-verification*
// @grant        GM_xmlhttpRequest
// @license      GPL3
// @updateURL    https://raw.githubusercontent.com/Yiipu/greasyfork/main/battlenet_auto_oauth.user.js
// @downloadURL  https://raw.githubusercontent.com/Yiipu/greasyfork/main/battlenet_auto_oauth.user.js
// ==/UserScript==

(function () {
    'use strict';

    const btn = document.querySelector("#root > div > div._verification-btns_1kkll_20 > button:nth-child(2)");
    if (btn) btn.click();

    const curAccountStr = localStorage.getItem("BX_CURRENT_ACCOUNT");
    const curAccount = curAccountStr ? JSON.parse(curAccountStr).account : null;
    const accountMetaStr = curAccount ? localStorage.getItem(curAccount) : null;

    if (accountMetaStr) {
        const { endpoint, token } = JSON.parse(accountMetaStr);

        GM_xmlhttpRequest({
            method: "POST",
            url: endpoint,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify({ token }),
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    console.log('Token sent successfully:', data);
                    const inputElement = document.querySelector("#root > div > div._mkey-code_1kkll_102 > input");
                    if (inputElement) {
                        inputElement.value = data;
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