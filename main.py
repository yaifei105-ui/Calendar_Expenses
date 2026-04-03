from fastapi import FastAPI, HTTPException, Query, File, UploadFile, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, List
import pymysql
import os
import json
import base64
import uuid
import hashlib
from datetime import datetime, date, timedelta

app = FastAPI(title="花费日历 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据库配置（通过环境变量获取）
DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "11.142.154.110"),
    "port": int(os.environ.get("DB_PORT", 3306)),
    "user": os.environ.get("DB_USER", "with_ghhdklifczfuchhv"),
    "password": os.environ.get("DB_PASSWORD", "v8Diue5xp#SCP!"),
    "database": os.environ.get("DB_NAME", "l65360zd"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
}

# 管理员用户名列表（通过环境变量配置，逗号分隔）
ADMIN_USERNAMES = [u.strip() for u in os.environ.get("ADMIN_USERNAMES", "admin").split(",") if u.strip()]

# 商家手机号（用于短信通知申请）
MERCHANT_PHONES = ["18500083101", "19953853265"]

# Token 有效期（天）
TOKEN_EXPIRE_DAYS = 30


def get_db():
    conn = pymysql.connect(**DB_CONFIG)
    return conn


def init_db():
    """数据库初始化"""
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            # 确保 receipt_url 字段为 LONGTEXT
            cursor.execute("""
                SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'expenses' AND COLUMN_NAME = 'receipt_url'
            """, (DB_CONFIG["database"],))
            col = cursor.fetchone()
            if col and col["DATA_TYPE"] not in ("longtext", "mediumtext"):
                cursor.execute("ALTER TABLE expenses MODIFY COLUMN receipt_url LONGTEXT")
                conn.commit()

            # 清理旧的无效 receipt_url
            cursor.execute("""
                UPDATE expenses SET receipt_url = NULL
                WHERE receipt_url IS NOT NULL
                  AND receipt_url LIKE '%%/static/uploads/%%'
                  AND receipt_url NOT LIKE 'data:%%'
            """)
            if cursor.rowcount > 0:
                conn.commit()
                print(f"已清理 {cursor.rowcount} 条旧的无效凭证路径")

            # 确保认证相关字段存在
            existing_cols = set()
            cursor.execute("DESCRIBE users")
            for row in cursor.fetchall():
                existing_cols.add(row["Field"])

            auth_cols = {
                "username": "VARCHAR(64) UNIQUE DEFAULT NULL",
                "password_hash": "VARCHAR(256) DEFAULT NULL",
                "password_salt": "VARCHAR(64) DEFAULT NULL",
                "auth_token": "VARCHAR(128) DEFAULT NULL",
                "token_expire_at": "DATETIME DEFAULT NULL",
            }
            for col_name, col_def in auth_cols.items():
                if col_name not in existing_cols:
                    try:
                        cursor.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}")
                        conn.commit()
                        print(f"已添加字段: {col_name}")
                    except Exception as e:
                        print(f"添加字段 {col_name} 失败（可能已存在）: {e}")

        conn.close()
    except Exception as e:
        print(f"数据库初始化警告: {e}")


@app.on_event("startup")
def on_startup():
    init_db()


# ==================== 密码与Token工具函数 ====================

def hash_password(password: str, salt: str = None) -> tuple:
    """对密码进行SHA256哈希，返回 (hash, salt)"""
    if salt is None:
        salt = uuid.uuid4().hex[:16]
    hashed = hashlib.sha256((password + salt).encode()).hexdigest()
    return hashed, salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    """验证密码"""
    hashed, _ = hash_password(password, salt)
    return hashed == password_hash


def generate_token() -> str:
    """生成登录Token"""
    return uuid.uuid4().hex + uuid.uuid4().hex[:16]


def get_current_user_from_token(request: Request) -> Optional[dict]:
    """从请求Header中提取Token并验证，返回用户信息"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    if not token:
        return None

    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM users WHERE auth_token = %s AND token_expire_at > NOW()",
                (token,)
            )
            user = cursor.fetchone()
            return user
    finally:
        conn.close()


def write_log(cursor, expense_id, operator_eng_name, operator_chn_name, action, old_data=None, new_data=None):
    """写入操作日志"""
    cursor.execute(
        """INSERT INTO expense_logs (expense_id, operator_eng_name, operator_chn_name, action, old_data, new_data)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (
            expense_id,
            operator_eng_name,
            operator_chn_name,
            action,
            json.dumps(old_data, ensure_ascii=False, default=str) if old_data else None,
            json.dumps(new_data, ensure_ascii=False, default=str) if new_data else None,
        )
    )


# ==================== 认证相关 API ====================

class RegisterRequest(BaseModel):
    username: str
    nickname: str
    password: str
    confirm_password: str


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/auth/register")
def auth_register(req: RegisterRequest):
    """用户注册"""
    # 验证用户名
    if not req.username or len(req.username) < 2 or len(req.username) > 20:
        raise HTTPException(status_code=400, detail="用户名长度需为2-20个字符")
    import re
    if not re.match(r'^[a-zA-Z0-9_\u4e00-\u9fa5]+$', req.username):
        raise HTTPException(status_code=400, detail="用户名仅允许字母、数字、下划线和中文")
    # 验证昵称
    if not req.nickname or len(req.nickname) < 1 or len(req.nickname) > 20:
        raise HTTPException(status_code=400, detail="昵称长度需为1-20个字符")
    # 验证密码
    if not req.password or len(req.password) < 6 or len(req.password) > 32:
        raise HTTPException(status_code=400, detail="密码长度需为6-32个字符")
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="两次密码输入不一致")

    conn = get_db()
    try:
        with conn.cursor() as cursor:
            # 检查用户名是否已存在
            cursor.execute("SELECT id FROM users WHERE username = %s", (req.username,))
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="用户名已被使用")

            # 哈希密码
            password_hash, password_salt = hash_password(req.password)

            # 判断是否为管理员
            is_admin = req.username in ADMIN_USERNAMES
            status = 1 if is_admin else 1  # 注册即激活，简化流程
            is_merchant = 1 if is_admin else 0

            # 生成Token
            token = generate_token()
            expire_at = datetime.now() + timedelta(days=TOKEN_EXPIRE_DAYS)

            # 创建用户（eng_name 等同于 username）
            cursor.execute(
                """INSERT INTO users (eng_name, chn_name, username, password_hash, password_salt,
                   auth_token, token_expire_at, is_merchant, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (req.username, req.nickname, req.username, password_hash, password_salt,
                 token, expire_at, is_merchant, status)
            )
            conn.commit()

            cursor.execute("SELECT * FROM users WHERE username = %s", (req.username,))
            user = cursor.fetchone()

            # 清理敏感字段
            user_safe = {
                "id": user["id"],
                "eng_name": user["eng_name"],
                "chn_name": user["chn_name"],
                "username": user["username"],
                "is_merchant": bool(user["is_merchant"]),
                "status": user["status"],
            }

            return {
                "success": True,
                "token": token,
                "user": user_safe,
                "message": "注册成功" + ("，您已被设为管理员" if is_admin else "")
            }
    finally:
        conn.close()


@app.post("/api/auth/login")
def auth_login(req: LoginRequest):
    """用户登录"""
    if not req.username or not req.password:
        raise HTTPException(status_code=400, detail="请输入用户名和密码")

    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE username = %s", (req.username,))
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=401, detail="用户名或密码错误")

            if not user.get("password_hash") or not user.get("password_salt"):
                raise HTTPException(status_code=401, detail="该账号尚未设置密码，请联系管理员")

            if not verify_password(req.password, user["password_hash"], user["password_salt"]):
                raise HTTPException(status_code=401, detail="用户名或密码错误")

            # 生成新Token
            token = generate_token()
            expire_at = datetime.now() + timedelta(days=TOKEN_EXPIRE_DAYS)
            cursor.execute(
                "UPDATE users SET auth_token = %s, token_expire_at = %s WHERE id = %s",
                (token, expire_at, user["id"])
            )
            conn.commit()

            user_safe = {
                "id": user["id"],
                "eng_name": user["eng_name"],
                "chn_name": user["chn_name"],
                "username": user.get("username"),
                "is_merchant": bool(user["is_merchant"]),
                "status": user["status"],
            }

            return {"success": True, "token": token, "user": user_safe}
    finally:
        conn.close()


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    """用户退出登录"""
    user = get_current_user_from_token(request)
    if not user:
        return {"success": True, "message": "已退出"}

    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET auth_token = NULL, token_expire_at = NULL WHERE id = %s",
                (user["id"],)
            )
            conn.commit()
        return {"success": True, "message": "已退出登录"}
    finally:
        conn.close()


@app.get("/api/users/me")
def get_current_user(request: Request):
    """获取当前登录用户信息（通过Token）"""
    user = get_current_user_from_token(request)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或Token已过期")

    user_safe = {
        "id": user["id"],
        "eng_name": user["eng_name"],
        "chn_name": user["chn_name"],
        "username": user.get("username"),
        "is_merchant": bool(user["is_merchant"]),
        "status": user["status"],
        "phone": user.get("phone"),
        "dept_name": user.get("dept_name"),
    }
    return {"success": True, "user": user_safe}


# ==================== 图片上传相关 ====================

@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    """上传花费凭证图片，转为 base64 data URL 返回"""
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="只支持 JPG/PNG/GIF/WEBP/HEIC 格式图片")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过5MB")

    from io import BytesIO
    try:
        from PIL import Image
        img = Image.open(BytesIO(content))
        max_size = 1200
        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        output = BytesIO()
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        img.save(output, format='JPEG', quality=75, optimize=True)
        compressed_content = output.getvalue()
        mime_type = "image/jpeg"
    except ImportError:
        compressed_content = content
        mime_type = file.content_type or "image/jpeg"

    b64_str = base64.b64encode(compressed_content).decode('utf-8')
    data_url = f"data:{mime_type};base64,{b64_str}"

    return {"success": True, "url": data_url}


# ==================== 用户相关（保留旧接口兼容） ====================

class UserInfo(BaseModel):
    eng_name: str
    chn_name: str
    dept_name: Optional[str] = None
    phone: Optional[str] = None


class ApplyPermission(BaseModel):
    eng_name: str
    phone: Optional[str] = None


@app.post("/api/users/login")
def user_login(user: UserInfo):
    """用户登录/注册（兼容旧的内网认证流程）"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE eng_name = %s", (user.eng_name,))
            existing = cursor.fetchone()
            if not existing:
                cursor.execute(
                    "INSERT INTO users (eng_name, chn_name, dept_name, phone, status) VALUES (%s, %s, %s, %s, 0)",
                    (user.eng_name, user.chn_name, user.dept_name, user.phone)
                )
                conn.commit()
                cursor.execute("SELECT * FROM users WHERE eng_name = %s", (user.eng_name,))
                existing = cursor.fetchone()
            else:
                cursor.execute(
                    "UPDATE users SET chn_name=%s, dept_name=%s WHERE eng_name=%s",
                    (user.chn_name, user.dept_name, user.eng_name)
                )
                conn.commit()
                cursor.execute("SELECT * FROM users WHERE eng_name = %s", (user.eng_name,))
                existing = cursor.fetchone()
            return {"success": True, "user": existing}
    finally:
        conn.close()


@app.post("/api/users/apply")
def apply_permission(body: ApplyPermission):
    """用户申请使用权限"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE eng_name = %s", (body.eng_name,))
            user = cursor.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="用户不存在")
            if user["status"] == 1:
                return {"success": True, "message": "已有权限"}
            cursor.execute(
                "UPDATE users SET status=0, phone=%s WHERE eng_name=%s",
                (body.phone, body.eng_name)
            )
            conn.commit()
            return {"success": True, "message": "申请已提交，等待商家审核", "merchant_phones": MERCHANT_PHONES}
    finally:
        conn.close()


@app.get("/api/users/check-merchant")
def check_merchant(eng_name: str = Query(...)):
    """检查用户是否是商家"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT is_merchant, status FROM users WHERE eng_name = %s", (eng_name,))
            user = cursor.fetchone()
            if not user:
                return {"is_merchant": False, "status": 0}
            return {"is_merchant": bool(user["is_merchant"]), "status": user.get("status", 1)}
    finally:
        conn.close()


@app.get("/api/users/list")
def list_users(status: Optional[int] = Query(None)):
    """商家端：获取所有用户列表"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            if status is not None:
                cursor.execute(
                    "SELECT id, eng_name, chn_name, dept_name, phone, is_merchant, status, created_at FROM users WHERE status=%s ORDER BY created_at DESC",
                    (status,)
                )
            else:
                cursor.execute(
                    "SELECT id, eng_name, chn_name, dept_name, phone, is_merchant, status, created_at FROM users ORDER BY created_at DESC"
                )
            users = cursor.fetchall()
            for u in users:
                if u.get("created_at"):
                    u["created_at"] = str(u["created_at"])
            return {"users": users}
    finally:
        conn.close()


@app.put("/api/users/{eng_name}/merchant")
def set_merchant(eng_name: str, is_merchant: int = Query(...)):
    """商家端：设置用户为商家"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("UPDATE users SET is_merchant=%s WHERE eng_name=%s", (is_merchant, eng_name))
            conn.commit()
            return {"success": True}
    finally:
        conn.close()


@app.put("/api/users/{eng_name}/status")
def set_user_status(eng_name: str, status: int = Query(...)):
    """商家端：审核用户权限"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("UPDATE users SET status=%s WHERE eng_name=%s", (status, eng_name))
            conn.commit()
            return {"success": True}
    finally:
        conn.close()


# ==================== 任务类型相关 ====================

class TaskTypeCreate(BaseModel):
    name: str
    icon: Optional[str] = "task"
    color: Optional[str] = "#6B7280"
    created_by: Optional[str] = None
    is_global: Optional[int] = 0


@app.get("/api/task-types")
def get_task_types(eng_name: Optional[str] = Query(None)):
    """获取任务类型列表"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            if eng_name:
                cursor.execute(
                    "SELECT * FROM task_types WHERE is_global=1 OR created_by=%s ORDER BY is_global DESC, id ASC",
                    (eng_name,)
                )
            else:
                cursor.execute("SELECT * FROM task_types ORDER BY id ASC")
            task_types = cursor.fetchall()
            return {"task_types": task_types}
    finally:
        conn.close()


@app.post("/api/task-types")
def create_task_type(tt: TaskTypeCreate):
    """创建任务类型"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO task_types (name, icon, color, created_by, is_global) VALUES (%s, %s, %s, %s, %s)",
                (tt.name, tt.icon, tt.color, tt.created_by, tt.is_global)
            )
            conn.commit()
            tt_id = cursor.lastrowid
            cursor.execute("SELECT * FROM task_types WHERE id=%s", (tt_id,))
            return {"success": True, "task_type": cursor.fetchone()}
    finally:
        conn.close()


@app.delete("/api/task-types/{tt_id}")
def delete_task_type(tt_id: int):
    """删除任务类型"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id FROM task_types WHERE id=%s", (tt_id,))
            tt = cursor.fetchone()
            if not tt:
                raise HTTPException(status_code=404, detail="类型不存在")
            cursor.execute("DELETE FROM task_types WHERE id=%s", (tt_id,))
            conn.commit()
            return {"success": True}
    finally:
        conn.close()


# ==================== 花费类型相关 ====================

class CategoryCreate(BaseModel):
    name: str
    icon: Optional[str] = "other"
    color: Optional[str] = "#6B7280"
    created_by: Optional[str] = None
    is_global: Optional[int] = 0


@app.get("/api/categories")
def get_categories(eng_name: Optional[str] = Query(None)):
    """获取花费类型列表"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            if eng_name:
                cursor.execute(
                    "SELECT * FROM expense_categories WHERE is_global=1 OR created_by=%s ORDER BY is_global DESC, id ASC",
                    (eng_name,)
                )
            else:
                cursor.execute("SELECT * FROM expense_categories ORDER BY id ASC")
            categories = cursor.fetchall()
            return {"categories": categories}
    finally:
        conn.close()


@app.post("/api/categories")
def create_category(cat: CategoryCreate):
    """创建花费类型"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO expense_categories (name, icon, color, created_by, is_global) VALUES (%s, %s, %s, %s, %s)",
                (cat.name, cat.icon, cat.color, cat.created_by, cat.is_global)
            )
            conn.commit()
            cat_id = cursor.lastrowid
            cursor.execute("SELECT * FROM expense_categories WHERE id=%s", (cat_id,))
            return {"success": True, "category": cursor.fetchone()}
    finally:
        conn.close()


@app.delete("/api/categories/{cat_id}")
def delete_category(cat_id: int):
    """删除花费类型"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id FROM expense_categories WHERE id=%s", (cat_id,))
            cat = cursor.fetchone()
            if not cat:
                raise HTTPException(status_code=404, detail="类型不存在")
            cursor.execute("DELETE FROM expense_categories WHERE id=%s", (cat_id,))
            conn.commit()
            return {"success": True}
    finally:
        conn.close()


# ==================== 花费记录相关 ====================

class ExpenseCreate(BaseModel):
    user_eng_name: str
    user_chn_name: Optional[str] = None
    category_id: Optional[int] = None
    task_type_id: Optional[int] = None
    amount: float
    expense_date: str
    location: Optional[str] = None
    note: Optional[str] = None
    receipt_url: Optional[str] = None


class ExpenseUpdate(BaseModel):
    category_id: Optional[int] = None
    task_type_id: Optional[int] = None
    amount: Optional[float] = None
    expense_date: Optional[str] = None
    location: Optional[str] = None
    note: Optional[str] = None
    receipt_url: Optional[str] = None


@app.get("/api/expenses")
def get_expenses(
    eng_name: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1),
    page_size: int = Query(50),
):
    """获取花费记录"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            conditions = []
            params = []

            if eng_name:
                conditions.append("e.user_eng_name = %s")
                params.append(eng_name)
            if year and month:
                conditions.append("YEAR(e.expense_date) = %s AND MONTH(e.expense_date) = %s")
                params.extend([year, month])
            elif year:
                conditions.append("YEAR(e.expense_date) = %s")
                params.append(year)
            if start_date:
                conditions.append("e.expense_date >= %s")
                params.append(start_date)
            if end_date:
                conditions.append("e.expense_date <= %s")
                params.append(end_date)

            where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

            cursor.execute(
                f"SELECT COUNT(*) as total FROM expenses e {where_clause}",
                params
            )
            total = cursor.fetchone()["total"]

            offset = (page - 1) * page_size
            cursor.execute(
                f"""SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
                    t.name as task_type_name, t.icon as task_type_icon, t.color as task_type_color,
                    TIMESTAMPDIFF(MINUTE, e.created_at, e.updated_at) as edit_minutes
                    FROM expenses e
                    LEFT JOIN expense_categories c ON e.category_id = c.id
                    LEFT JOIN task_types t ON e.task_type_id = t.id
                    {where_clause}
                    ORDER BY e.expense_date DESC, e.created_at DESC
                    LIMIT %s OFFSET %s""",
                params + [page_size, offset]
            )
            expenses = cursor.fetchall()

            for exp in expenses:
                if exp.get("expense_date"):
                    exp["expense_date"] = str(exp["expense_date"])
                if exp.get("created_at"):
                    exp["created_at"] = str(exp["created_at"])
                if exp.get("updated_at"):
                    exp["updated_at"] = str(exp["updated_at"])

            return {"expenses": expenses, "total": total, "page": page, "page_size": page_size}
    finally:
        conn.close()


@app.get("/api/expenses/{exp_id}/logs")
def get_expense_logs(exp_id: int):
    """获取某条花费记录的操作日志"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT * FROM expense_logs WHERE expense_id = %s ORDER BY created_at ASC""",
                (exp_id,)
            )
            logs = cursor.fetchall()
            for log in logs:
                if log.get("created_at"):
                    log["created_at"] = str(log["created_at"])
                if log.get("old_data") and isinstance(log["old_data"], str):
                    try:
                        log["old_data"] = json.loads(log["old_data"])
                    except:
                        pass
                if log.get("new_data") and isinstance(log["new_data"], str):
                    try:
                        log["new_data"] = json.loads(log["new_data"])
                    except:
                        pass
            return {"logs": logs}
    finally:
        conn.close()


@app.get("/api/expenses/stats")
def get_expense_stats(
    eng_name: Optional[str] = Query(None),
    eng_names: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    """获取花费统计"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            conditions = []
            params = []

            if eng_names:
                names_list = [n.strip() for n in eng_names.split(",") if n.strip()]
                if names_list:
                    placeholders = ",".join(["%s"] * len(names_list))
                    conditions.append(f"e.user_eng_name IN ({placeholders})")
                    params.extend(names_list)
            elif eng_name:
                conditions.append("e.user_eng_name = %s")
                params.append(eng_name)

            if year and month:
                conditions.append("YEAR(e.expense_date) = %s AND MONTH(e.expense_date) = %s")
                params.extend([year, month])
            elif year:
                conditions.append("YEAR(e.expense_date) = %s")
                params.append(year)
            if start_date:
                conditions.append("e.expense_date >= %s")
                params.append(start_date)
            if end_date:
                conditions.append("e.expense_date <= %s")
                params.append(end_date)

            where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

            cursor.execute(
                f"""SELECT c.name as category_name, c.icon as category_icon, c.color as category_color,
                    SUM(e.amount) as total_amount, COUNT(*) as count
                    FROM expenses e
                    LEFT JOIN expense_categories c ON e.category_id = c.id
                    {where_clause}
                    GROUP BY e.category_id, c.name, c.icon, c.color
                    ORDER BY total_amount DESC""",
                params
            )
            by_category = cursor.fetchall()

            cursor.execute(
                f"""SELECT e.expense_date, SUM(e.amount) as total_amount, COUNT(*) as count
                    FROM expenses e
                    {where_clause}
                    GROUP BY e.expense_date
                    ORDER BY e.expense_date ASC""",
                params
            )
            by_date = cursor.fetchall()
            for item in by_date:
                item["expense_date"] = str(item["expense_date"])

            cursor.execute(
                f"SELECT SUM(amount) as total, COUNT(*) as count FROM expenses e {where_clause}",
                params
            )
            summary = cursor.fetchone()

            cursor.execute(
                f"""SELECT e.user_eng_name, e.user_chn_name, SUM(e.amount) as total_amount, COUNT(*) as count
                    FROM expenses e
                    {where_clause}
                    GROUP BY e.user_eng_name, e.user_chn_name
                    ORDER BY total_amount DESC""",
                params
            )
            by_user = cursor.fetchall()

            return {
                "by_category": by_category,
                "by_date": by_date,
                "by_user": by_user,
                "summary": summary
            }
    finally:
        conn.close()


@app.post("/api/expenses")
def create_expense(expense: ExpenseCreate):
    """创建花费记录"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """INSERT INTO expenses (user_eng_name, user_chn_name, category_id, task_type_id, amount, expense_date, location, note, receipt_url)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (expense.user_eng_name, expense.user_chn_name, expense.category_id, expense.task_type_id,
                 expense.amount, expense.expense_date, expense.location, expense.note, expense.receipt_url)
            )
            conn.commit()
            exp_id = cursor.lastrowid

            new_data = {
                "user_eng_name": expense.user_eng_name,
                "category_id": expense.category_id,
                "task_type_id": expense.task_type_id,
                "amount": expense.amount,
                "expense_date": expense.expense_date,
                "location": expense.location,
                "note": expense.note
            }
            write_log(cursor, exp_id, expense.user_eng_name, expense.user_chn_name, "create", None, new_data)
            conn.commit()

            cursor.execute(
                """SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
                   t.name as task_type_name, t.icon as task_type_icon, t.color as task_type_color
                   FROM expenses e
                   LEFT JOIN expense_categories c ON e.category_id = c.id
                   LEFT JOIN task_types t ON e.task_type_id = t.id
                   WHERE e.id=%s""",
                (exp_id,)
            )
            exp = cursor.fetchone()
            if exp:
                exp["expense_date"] = str(exp["expense_date"])
                exp["created_at"] = str(exp["created_at"])
                exp["updated_at"] = str(exp["updated_at"])
            return {"success": True, "expense": exp}
    finally:
        conn.close()


@app.put("/api/expenses/{exp_id}")
def update_expense(exp_id: int, expense: ExpenseUpdate, operator: str = Query(...)):
    """更新花费记录"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM expenses WHERE id=%s", (exp_id,))
            existing = cursor.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="记录不存在")

            cursor.execute("SELECT is_merchant, chn_name FROM users WHERE eng_name=%s", (operator,))
            op_user = cursor.fetchone()
            is_merchant = op_user and op_user["is_merchant"]
            operator_chn = op_user["chn_name"] if op_user else operator

            if existing["user_eng_name"] != operator and not is_merchant:
                raise HTTPException(status_code=403, detail="无权限修改")

            old_data = {
                "category_id": existing["category_id"],
                "task_type_id": existing.get("task_type_id"),
                "amount": float(existing["amount"]) if existing["amount"] else None,
                "expense_date": str(existing["expense_date"]) if existing["expense_date"] else None,
                "location": existing.get("location"),
                "note": existing["note"]
            }

            updates = []
            params = []
            new_data = {}
            if expense.category_id is not None:
                updates.append("category_id=%s")
                params.append(expense.category_id)
                new_data["category_id"] = expense.category_id
            if expense.task_type_id is not None:
                updates.append("task_type_id=%s")
                params.append(expense.task_type_id)
                new_data["task_type_id"] = expense.task_type_id
            if expense.amount is not None:
                updates.append("amount=%s")
                params.append(expense.amount)
                new_data["amount"] = expense.amount
            if expense.expense_date is not None:
                updates.append("expense_date=%s")
                params.append(expense.expense_date)
                new_data["expense_date"] = expense.expense_date
            if expense.location is not None:
                updates.append("location=%s")
                params.append(expense.location)
                new_data["location"] = expense.location
            if expense.note is not None:
                updates.append("note=%s")
                params.append(expense.note)
                new_data["note"] = expense.note
            if expense.receipt_url is not None:
                updates.append("receipt_url=%s")
                params.append(expense.receipt_url)
                new_data["receipt_url"] = expense.receipt_url

            if updates:
                params.append(exp_id)
                cursor.execute(f"UPDATE expenses SET {', '.join(updates)} WHERE id=%s", params)
                write_log(cursor, exp_id, operator, operator_chn, "update", old_data, new_data)
                conn.commit()

            cursor.execute(
                """SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
                   t.name as task_type_name, t.icon as task_type_icon, t.color as task_type_color,
                   TIMESTAMPDIFF(MINUTE, e.created_at, e.updated_at) as edit_minutes
                   FROM expenses e
                   LEFT JOIN expense_categories c ON e.category_id = c.id
                   LEFT JOIN task_types t ON e.task_type_id = t.id
                   WHERE e.id=%s""",
                (exp_id,)
            )
            exp = cursor.fetchone()
            if exp:
                exp["expense_date"] = str(exp["expense_date"])
                exp["created_at"] = str(exp["created_at"])
                exp["updated_at"] = str(exp["updated_at"])
            return {"success": True, "expense": exp}
    finally:
        conn.close()


@app.delete("/api/expenses/{exp_id}")
def delete_expense(exp_id: int, operator: str = Query(...)):
    """删除花费记录"""
    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM expenses WHERE id=%s", (exp_id,))
            existing = cursor.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="记录不存在")

            cursor.execute("SELECT is_merchant, chn_name FROM users WHERE eng_name=%s", (operator,))
            op_user = cursor.fetchone()
            is_merchant = op_user and op_user["is_merchant"]
            operator_chn = op_user["chn_name"] if op_user else operator

            if existing["user_eng_name"] != operator and not is_merchant:
                raise HTTPException(status_code=403, detail="无权限删除")

            old_data = {
                "category_id": existing["category_id"],
                "task_type_id": existing.get("task_type_id"),
                "amount": float(existing["amount"]) if existing["amount"] else None,
                "expense_date": str(existing["expense_date"]) if existing["expense_date"] else None,
                "location": existing.get("location"),
                "note": existing["note"]
            }
            write_log(cursor, exp_id, operator, operator_chn, "delete", old_data, None)

            cursor.execute("DELETE FROM expenses WHERE id=%s", (exp_id,))
            conn.commit()
            return {"success": True}
    finally:
        conn.close()


# ==================== 批量删除（带密码验证） ====================

BATCH_DELETE_PASSWORD = os.environ.get("BATCH_DELETE_PASSWORD", "delete2026")


class BatchDeleteRequest(BaseModel):
    eng_name: str
    start_date: str
    end_date: str
    password: str


@app.post("/api/expenses/batch-delete")
def batch_delete_expenses(req: BatchDeleteRequest):
    """批量删除指定时间范围内的花费记录"""
    if req.password != BATCH_DELETE_PASSWORD:
        raise HTTPException(status_code=403, detail="密码错误，无法执行删除操作")

    if not req.start_date or not req.end_date:
        raise HTTPException(status_code=400, detail="请指定开始和结束日期")

    conn = get_db()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT is_merchant, chn_name FROM users WHERE eng_name=%s", (req.eng_name,))
            op_user = cursor.fetchone()
            is_merchant = op_user and op_user["is_merchant"]
            operator_chn = op_user["chn_name"] if op_user else req.eng_name

            conditions = ["expense_date >= %s", "expense_date <= %s"]
            params = [req.start_date, req.end_date]

            if not is_merchant:
                conditions.append("user_eng_name = %s")
                params.append(req.eng_name)

            where_clause = " AND ".join(conditions)

            cursor.execute(
                f"SELECT id, user_eng_name, amount, expense_date, category_id, task_type_id, location, note FROM expenses WHERE {where_clause}",
                params
            )
            records = cursor.fetchall()

            if not records:
                return {"success": True, "deleted_count": 0, "message": "该时间范围内没有记录"}

            for rec in records:
                old_data = {
                    "category_id": rec["category_id"],
                    "task_type_id": rec.get("task_type_id"),
                    "amount": float(rec["amount"]) if rec["amount"] else None,
                    "expense_date": str(rec["expense_date"]) if rec["expense_date"] else None,
                    "location": rec.get("location"),
                    "note": rec.get("note")
                }
                write_log(cursor, rec["id"], req.eng_name, operator_chn, "batch_delete", old_data, None)

            cursor.execute(f"DELETE FROM expenses WHERE {where_clause}", params)
            deleted_count = cursor.rowcount
            conn.commit()

            return {"success": True, "deleted_count": deleted_count, "message": f"成功删除 {deleted_count} 条记录"}
    finally:
        conn.close()


@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")


app.mount("/static", StaticFiles(directory="static", html=True), name="static")
```