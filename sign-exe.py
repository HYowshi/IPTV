#!/usr/bin/env python3
"""
Code Signing Script v1.0
Ký file EXE bằng self-sign certificate để Windows SmartScreen tin tưởng.

Usage:
    python sign-exe.py                          # Ký file trong src-tauri/target/release/bundle/nsis/
    python sign-exe.py --file Phim.tv_1.1.0_x64-setup.exe
    python sign-exe.py --generate-cert          # Tạo certificate mới
    python sign-exe.py --help

Yêu cầu Windows: signtool.exe (có trong Windows SDK)
"""

import os
import sys
import subprocess
import argparse
import glob

def find_signtool():
    """Tìm signtool.exe trên Windows."""
    paths = [
        r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe",
        r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22000.0\x64\signtool.exe",
        r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe",
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    # Try to find via PATH
    try:
        result = subprocess.run(["where", "signtool"], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip().split('\n')[0]
    except:
        pass
    return None

def find_makecert():
    """Tìm makecert.exe trên Windows."""
    paths = [
        r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\makecert.exe",
        r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22000.0\x64\makecert.exe",
        r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\makecert.exe",
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    try:
        result = subprocess.run(["where", "makecert"], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip().split('\n')[0]
    except:
        pass
    return None

def generate_cert(cert_dir="src-tauri/nsis"):
    """Tạo self-sign certificate cho code signing."""
    os.makedirs(cert_dir, exist_ok=True)
    cert_path = os.path.join(cert_dir, "phimtv-signing.pfx")
    cert_pass = "PhimTV2026Sign!"

    if os.path.exists(cert_path):
        print(f"Certificate đã tồn tại: {cert_path}")
        return cert_path, cert_pass

    # Try PowerShell method (works on all Windows)
    ps_script = f'''
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject "CN=PhimTV Admin, O=PhimTV, L=HCM, S=VN, C=VN" `
        -CertStoreLocation Cert:\\CurrentUser\\My `
        -NotAfter (Get-Date).AddYears(10) `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -TextExtension @("2.5.29.37={{text}}1.3.6.1.5.5.7.3.3")

    $pwd = ConvertTo-SecureString -String "{cert_pass}" -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath "{cert_path}" -Password $pwd
    Write-Host "Certificate exported to {cert_path}"
    '''

    try:
        result = subprocess.run(
            ["powershell", "-Command", ps_script],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0 and os.path.exists(cert_path):
            print(f"Certificate tạo thành công: {cert_path}")
            return cert_path, cert_pass
        else:
            print(f"Lỗi tạo certificate: {result.stderr}")
    except Exception as e:
        print(f"Lỗi: {e}")

    return None, None

def sign_file(exe_path, cert_path, cert_pass):
    """Ký file EXE bằng certificate."""
    signtool = find_signtool()
    if not signtool:
        print("Không tìm thấy signtool.exe. Cần cài Windows SDK.")
        print("Hoặc dùng PowerShell: Set-AuthenticodeSignature")
        # Fallback to PowerShell
        return sign_with_powershell(exe_path, cert_path, cert_pass)

    cmd = [
        signtool, "sign",
        "/f", cert_path,
        "/p", cert_pass,
        "/fd", "SHA256",
        "/tr", "http://timestamp.digicert.com",
        "/td", "SHA256",
        "/d", "Phim.tv - Giai Tri Da Phuong Tien",
        "/du", "https://github.com/HYowshi/IPTV",
        exe_path
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            print(f"  ✅ Đã ký: {os.path.basename(exe_path)}")
            return True
        else:
            print(f"  ❌ Lỗi ký: {result.stderr}")
            return False
    except Exception as e:
        print(f"  ❌ Lỗi: {e}")
        return False

def sign_with_powershell(exe_path, cert_path, cert_pass):
    """Ký bằng PowerShell (fallback)."""
    ps_script = f'''
    $pwd = ConvertTo-SecureString -String "{cert_pass}" -Force -AsPlainText
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("{cert_path}", $pwd)
    Set-AuthenticodeSignature -FilePath "{exe_path}" -Certificate $cert -HashAlgorithm SHA256 -TimestampServer "http://timestamp.digicert.com"
    '''
    try:
        result = subprocess.run(
            ["powershell", "-Command", ps_script],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            print(f"  ✅ Đã ký (PowerShell): {os.path.basename(exe_path)}")
            return True
        else:
            print(f"  ❌ Lỗi ký: {result.stderr}")
            return False
    except Exception as e:
        print(f"  ❌ Lỗi: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Code Signing Script - Ký EXE cho Phim.tv')
    parser.add_argument('--file', help='File EXE cần ký')
    parser.add_argument('--generate-cert', action='store_true', help='Tạo certificate mới')
    parser.add_argument('--cert-dir', default='src-tauri/nsis', help='Thư mục chứa certificate')
    parser.add_argument('--cert-path', help='Đường dẫn certificate PFX')
    parser.add_argument('--cert-pass', default='PhimTV2026Sign!', help='Password certificate')
    args = parser.parse_args()

    print("=== Phim.tv Code Signing ===\n")

    # Generate certificate if requested
    if args.generate_cert:
        cert_path, cert_pass = generate_cert(args.cert_dir)
        if cert_path:
            print(f"\nCertificate: {cert_path}")
            print(f"Password: {cert_pass}")
            print("\nLưu lại password này để sử dụng khi ký!")
        return

    # Find certificate
    cert_path = args.cert_path
    if not cert_path:
        cert_path = os.path.join(args.cert_dir, "phimtv-signing.pfx")

    if not os.path.exists(cert_path):
        print(f"Không tìm thấy certificate: {cert_path}")
        print("Chạy: python sign-exe.py --generate-cert")
        return

    cert_pass = args.cert_pass

    # Find EXE files to sign
    if args.file:
        exe_files = [args.file]
    else:
        # Auto-find NSIS installer
        nsis_dir = "src-tauri/target/release/bundle/nsis"
        exe_files = glob.glob(os.path.join(nsis_dir, "*.exe"))
        if not exe_files:
            print(f"Không tìm thấy file EXE trong {nsis_dir}")
            return

    print(f"Certificate: {cert_path}")
    print(f"Files cần ký: {len(exe_files)}\n")

    success = 0
    for exe in exe_files:
        if sign_file(exe, cert_path, cert_pass):
            success += 1

    print(f"\nHoàn thành: {success}/{len(exe_files)} file đã ký")

    if success > 0:
        print("\nLưu ý: Windows SmartScreen vẫn có thể hiện cảnh báo lần đầu.")
        print("Sau khi nhiều người download, SmartScreen sẽ tự tin tưởng.")

if __name__ == "__main__":
    main()