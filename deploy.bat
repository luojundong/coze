@echo off
chcp 65001 >nul
echo ==========================================
echo  扣子智能体中转平台 - 一键部署
echo  目标: 39.107.192.68
echo ==========================================
echo.

REM Step 1: 打包
echo [1/4] 打包项目代码...
powershell -ExecutionPolicy Bypass -File "%~dp0pack.ps1"
echo.

REM Step 2: 上传
echo [2/4] 上传到服务器...
echo 密码: zxcvbnm,./1
scp -o StrictHostKeyChecking=no "%~dp0coze-deploy.zip" root@39.107.192.68:/tmp/coze-deploy.zip
echo.

REM Step 3: 上传部署脚本
echo [3/4] 上传部署脚本...
echo 密码: zxcvbnm,./1
scp -o StrictHostKeyChecking=no "%~dp0remote-deploy.sh" root@39.107.192.68:/tmp/remote-deploy.sh
echo.

REM Step 4: 远程执行
echo [4/4] 远程部署（安装环境+构建+启动）...
echo 密码: zxcvbnm,./1
ssh -o StrictHostKeyChecking=no root@39.107.192.68 "bash /tmp/remote-deploy.sh"
echo.

echo ==========================================
echo  部署完成!
echo  访问: http://39.107.192.68
echo ==========================================
pause
