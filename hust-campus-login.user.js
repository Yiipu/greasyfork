// ==UserScript==
// @name         HUST 校园网自动登录 + 账号切换
// @namespace    https://github.com/Yiipu
// @version      1.0.0
// @description  本地（❗明文❗）保存账号密码，支持自动登录、一键切换账号。
// @author       Yiipu
// @match        http://172.18.18.61:8080/eportal/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Yiipu/greasyfork/main/hust-campus-login.user.js
// @downloadURL  https://raw.githubusercontent.com/Yiipu/greasyfork/main/hust-campus-login.user.js
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'accounts';
    const SWITCH_ACCOUNT_KEY = 'switchAccountTo';

    // 工具函数
    function getAccounts() {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    }

    function saveAccount(username, password) {
        const accounts = getAccounts();
        accounts[username] = password;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    }

    function setTargetAccount(username) {
        localStorage.setItem(SWITCH_ACCOUNT_KEY, username);
    }

    function getTargetAccount() {
        return localStorage.getItem(SWITCH_ACCOUNT_KEY);
    }

    function clearTargetAccount() {
        localStorage.removeItem(SWITCH_ACCOUNT_KEY);
    }

    // 登录页面逻辑
    function handleLoginPage() {
        const trigger_usr = document.querySelector('#username_tip.input_tip');
        const trigger_pwd = document.querySelector('#pwd_tip.input_tip');

        if (!(trigger_usr && trigger_pwd)) {
            console.log('等待触发器加载...');
            setTimeout(handleLoginPage, 500);
            return;
        }

        trigger_usr.click();
        trigger_pwd.click();

        const checkInputs = setInterval(() => {
            const usernameInput = document.querySelector('#username.input');
            const passwordInput = document.querySelector('#pwd.input');
            const loginButton = document.querySelector('#loginLink');

            if (usernameInput && passwordInput && loginButton) {
                clearInterval(checkInputs);
                injectLoginUI(usernameInput, passwordInput, loginButton);
            }
        }, 500);
    }

    function injectLoginUI(usernameInput, passwordInput, loginButton) {
        const container = document.querySelector('#connectNetworkPageId');
        const accountSelector = document.createElement('select');
        const saveButton = document.createElement('button');
        saveButton.textContent = '保存当前账号';

        container.appendChild(accountSelector);
        container.appendChild(saveButton);

        const accounts = getAccounts();
        updateSelector();

        accountSelector.addEventListener('change', function () {
            const selectedUser = this.value;
            if (selectedUser && accounts[selectedUser]) {
                usernameInput.value = selectedUser;
                passwordInput.value = accounts[selectedUser];
                loginButton.click(); // 自动登录

                // 如果是从“切换账号”跳转回来，则清除记录
                if (getTargetAccount() === selectedUser) {
                    clearTargetAccount();
                }
            }
        });

        saveButton.addEventListener('click', function () {
            const user = usernameInput.value;
            const pass = passwordInput.value;
            if (user && pass) {
                saveAccount(user, pass);
                updateSelector();
                alert('账号已保存');
            } else {
                alert('请输入账号和密码');
            }
        });

        function updateSelector() {
            accountSelector.innerHTML = '';
            const defaultOption = document.createElement('option');
            defaultOption.textContent = '选择账号';
            defaultOption.value = '';
            accountSelector.appendChild(defaultOption);

            for (const user in accounts) {
                const option = document.createElement('option');
                option.value = user;
                option.textContent = user;
                accountSelector.appendChild(option);
            }

            // 如果有待登录账号，自动选择
            const target = getTargetAccount();
            if (target && accounts[target]) {
                accountSelector.value = target;
                usernameInput.value = target;
                passwordInput.value = accounts[target];
                loginButton.click();
            }
        }
    }

    // 登录成功页逻辑
    function handleSuccessPage() {
        const container = document.querySelector("#maintable > tbody > tr:nth-child(1) > td:nth-child(3)");
        const switchContainer = document.createElement('div');
        const accountSelector = document.createElement('select');
        const switchButton = document.createElement('button');

        switchContainer.style.marginTop = '20px';
        switchButton.textContent = '切换账号';

        switchContainer.appendChild(accountSelector);
        switchContainer.appendChild(switchButton);
        container.appendChild(switchContainer);

        const accounts = getAccounts();

        const defaultOption = document.createElement('option');
        defaultOption.textContent = '选择账号';
        defaultOption.value = '';
        accountSelector.appendChild(defaultOption);

        for (const user in accounts) {
            const option = document.createElement('option');
            option.value = user;
            option.textContent = user;
            accountSelector.appendChild(option);
        }

        switchButton.addEventListener('click', function () {
            const selected = accountSelector.value;
            if (selected && accounts[selected]) {
                setTargetAccount(selected);
                sureLogout(); // 页面自身的全局函数
            } else {
                alert('请选择一个账号');
            }
        });
    }

    // 注销页面逻辑（自动跳转回登录页）
    function handleLogoutPage() {
        location.href = 'http://172.18.18.61:8080/eportal/gologout.jsp';
    }

    // 主程序：根据 URL 决定逻辑
    const url = location.href;

    if (url.includes('eportal/index.jsp')) {
        handleLoginPage();
    } else if (url.includes('eportal/success.jsp')) {
        handleSuccessPage();
    } else if (url.includes('eportal/logout.jsp')) {
        handleLogoutPage();
    }
})();
