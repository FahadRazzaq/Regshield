from sqlalchemy import Column, String, DateTime, Text, Integer, Boolean, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship
from config import db
from werkzeug.security import generate_password_hash, check_password_hash

class User(db.Model):
    __tablename__ = 'user'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    username = db.Column(String(80), unique=True, nullable=False)
    email = db.Column(String(120), unique=True, nullable=False)
    password_hash = db.Column(String(256), nullable=False)
    phone_number = db.Column(String(20), nullable=True)
    linkedin_id = db.Column(String(255), nullable=True)
    case_threads = relationship('CaseThread', backref='user', lazy=True)
    contract_threads = relationship('ContractThread', backref='user', lazy=True)

    def set_password(self, password): self.password_hash = generate_password_hash(password)
    def check_password(self, password): return check_password_hash(self.password_hash, password)

class ChatMessageLincolnChat(db.Model):
    __tablename__ = 'chat_message_lincoln_chat'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    chat_id = db.Column(String(50), nullable=False)
    user_message = db.Column(Text, nullable=False)
    bot_response = db.Column(Text, nullable=True)
    timestamp = db.Column(DateTime, server_default=db.func.current_timestamp())
    user_id = db.Column(Integer, db.ForeignKey('user.id'), nullable=False)

class CaseThread(db.Model):
    __tablename__ = 'case_thread'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(Integer, ForeignKey('user.id'), nullable=False)
    prompt = db.Column(Text, nullable=False)
    created_at = db.Column(DateTime, server_default=db.func.current_timestamp())
    case_details = db.Column(Text, nullable=True)
    api_fetched = db.Column(Boolean, default=False)
    keywords = relationship('Keyword', backref='case_thread', lazy=True)
    api_results = relationship('APIResult', backref='case_thread', lazy=True)
    summaries = relationship('Summary', backref='case_thread', lazy=True)
    messages = relationship('ChatMessageLincolnCase', backref='case_thread', lazy=True)
    refined_response = db.Column(Text, nullable=True)
    status = db.Column(String(20), default='pending')

class ChatMessageLincolnCase(db.Model):
    __tablename__ = 'chat_message_lincoln_case'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    case_thread_id = db.Column(Integer, ForeignKey('case_thread.id'), nullable=False)
    user_message = db.Column(Text, nullable=False)
    bot_response = db.Column(Text)
    timestamp = db.Column(DateTime, server_default=db.func.current_timestamp())

class Keyword(db.Model):
    __tablename__ = 'keyword'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    case_thread_id = db.Column(Integer, ForeignKey('case_thread.id'), nullable=False)
    keyword = db.Column(String(255), nullable=False)
    __table_args__ = (db.UniqueConstraint('case_thread_id', 'keyword', name='unique_case_keyword'),)

class APIResult(db.Model):
    __tablename__ = 'api_result'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    case_thread_id = db.Column(Integer, ForeignKey('case_thread.id'), nullable=False)
    tid = db.Column(Integer)
    result = db.Column(Text, nullable=False)

class Summary(db.Model):
    __tablename__ = 'summary'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    case_thread_id = db.Column(Integer, ForeignKey('case_thread.id'), nullable=False)
    summary = db.Column(Text, nullable=False)
    created_at = db.Column(DateTime, server_default=db.func.current_timestamp())

class CombinationKeywords(db.Model):
    __tablename__ = 'combination_keywords'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    case_thread_id = db.Column(Integer, ForeignKey('case_thread.id'), nullable=False)
    combination = db.Column(String(511), nullable=False)
    __table_args__ = (db.UniqueConstraint('case_thread_id', 'combination', name='unique_case_combination'),)

class ContractThread(db.Model):
    __tablename__ = 'contract_thread'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(Integer, ForeignKey('user.id'), nullable=False)
    prompt = db.Column(Text, nullable=False)
    created_at = db.Column(DateTime, server_default=db.func.current_timestamp())
    contract_details = db.Column(Text, nullable=True)
    status = db.Column(String(20), default='pending')
    messages = relationship('ContractMessage', backref='contract_thread', lazy=True)
    reference_contracts = relationship('ReferenceContract', backref='contract_thread', lazy=True)
    drafted_contracts = relationship('DraftedContract', backref='contract_thread', lazy=True)
    drafted_contract_sections = relationship('DraftedContractSection', backref='contract_thread', lazy=True)

class ContractMessage(db.Model):
    __tablename__ = 'contract_message'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    contract_thread_id = db.Column(Integer, ForeignKey('contract_thread.id'), nullable=False)
    user_message = db.Column(Text, nullable=False)
    bot_response = db.Column(Text, nullable=True)
    timestamp = db.Column(DateTime, server_default=db.func.current_timestamp())

class SampleContract(db.Model):
    __tablename__ = 'sample_contract'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    contract_type = db.Column(String(100), nullable=False)
    industry = db.Column(String(100))
    content = db.Column(Text, nullable=False)
    contract_metadata = db.Column(Text)

class TemplateContract(db.Model):
    __tablename__ = 'template_contract'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    contract_type = db.Column(String(100), nullable=False)
    content = db.Column(Text, nullable=False)
    created_at = db.Column(DateTime, server_default=db.func.current_timestamp())

class ReferenceContract(db.Model):
    __tablename__ = 'reference_contract'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    contract_thread_id = db.Column(Integer, ForeignKey('contract_thread.id'), nullable=False)
    content = db.Column(Text, nullable=False)
    created_at = db.Column(DateTime, server_default=db.func.current_timestamp())

class DraftedContract(db.Model):
    __tablename__ = 'drafted_contract'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    contract_thread_id = db.Column(Integer, ForeignKey('contract_thread.id'), nullable=False)
    content = db.Column(Text, nullable=False)
    created_at = db.Column(DateTime, server_default=db.func.current_timestamp())

class DraftedContractSection(db.Model):
    __tablename__ = 'drafted_contract_section'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    contract_thread_id = db.Column(Integer, ForeignKey('contract_thread.id'), nullable=False)
    drafted_contract_id = db.Column(Integer, ForeignKey('drafted_contract.id'), nullable=False)
    section_title = db.Column(String(255), nullable=False)
    content = db.Column(Text, nullable=False)
    order_index = db.Column(Integer, nullable=False)

class ReviewThread(db.Model):
    __tablename__ = 'review_thread'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(Integer, nullable=False)
    created_at = db.Column(DateTime, nullable=False, server_default=db.func.current_timestamp())
    doc_type = db.Column(String(100), nullable=True)
    pdf_data = db.Column(LargeBinary)
    docx_data = db.Column(LargeBinary, nullable=True)
    status = db.Column(String(50), default='pending')

class DocSection(db.Model):
    __tablename__ = 'doc_section'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    title = db.Column(Text, nullable=False)
    level = db.Column(Integer, nullable=False)
    order_index = db.Column(Integer, nullable=False)
    created_at = db.Column(DateTime, nullable=False, server_default=db.func.current_timestamp())
    review_thread_id = db.Column(Integer, ForeignKey('review_thread.id'), nullable=False)

class ReviewSection(db.Model):
    __tablename__ = 'review_section'
    id = db.Column(Integer, primary_key=True, autoincrement=True)
    section_title = db.Column(Text, nullable=False)
    content = db.Column(Text, nullable=False)
    page_number = db.Column(Integer, nullable=False)
    order_index = db.Column(Integer, nullable=False)
    created_at = db.Column(DateTime, nullable=False, server_default=db.func.current_timestamp())
    status = db.Column(String(50), default='open')
    review_thread_id = db.Column(Integer, ForeignKey('review_thread.id'), nullable=False)
    paragraph_index = db.Column(Integer, nullable=True)

class ReviewIssue(db.Model):
    __tablename__ = 'review_issue'
    id = db.Column(Integer, primary_key=True)
    review_section_id = db.Column(Integer, ForeignKey('review_section.id'), nullable=True)
    issue_type = db.Column(String(100), nullable=False)
    description = db.Column(Text, nullable=False)
    suggested_action = db.Column(Text)
    suggested_text = db.Column(Text)
    severity = db.Column(String(50), nullable=False)
    level = db.Column(String(50), nullable=False)
    created_at = db.Column(DateTime, nullable=False, server_default=db.func.current_timestamp())
    status = db.Column(String(50), default='open')
    review_thread_id = db.Column(Integer, ForeignKey('review_thread.id'), nullable=False)
    target_text = db.Column(Text, nullable=True)
    start_pos = db.Column(Integer, nullable=True)
    end_pos = db.Column(Integer, nullable=True)
