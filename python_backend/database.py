"""
Database module for Local AI Video Recorder
Uses SQLAlchemy with SQLite for persistent storage
"""

import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from contextlib import contextmanager
import logging

logger = logging.getLogger(__name__)

# Database configuration
DATABASE_FILE = "meetings.db"
DATABASE_URL = f"sqlite:///{DATABASE_FILE}"

# Create engine
engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False}
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()


# ==================== Models ====================

class Recording(Base):
    """Main recordings table"""
    __tablename__ = "recordings"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False, index=True)
    video_path = Column(String(500), nullable=False)  # Original .webm
    audio_path = Column(String(500), nullable=True)   # Extracted .wav
    compressed_path = Column(String(500), nullable=True)  # Web-friendly .mp4
    transcript_json = Column(Text, nullable=True)  # Full transcript as JSON
    summary_text = Column(Text, nullable=True)
    duration_seconds = Column(Integer, default=0)
    file_size_mb = Column(Integer, default=0)
    language = Column(String(10), default="unknown")
    status = Column(String(50), default="processing", index=True)  # processing, completed, failed
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    speakers = relationship("Speaker", back_populates="recording", cascade="all, delete-orphan")
    
    def to_dict(self):
        """Convert to dictionary for JSON serialization"""
        return {
            "id": self.id,
            "title": self.title,
            "video_path": self.video_path,
            "audio_path": self.audio_path,
            "compressed_path": self.compressed_path,
            "transcript_json": self.transcript_json,
            "summary_text": self.summary_text,
            "duration_seconds": self.duration_seconds,
            "file_size_mb": self.file_size_mb,
            "language": self.language,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "speakers": [s.to_dict() for s in self.speakers] if self.speakers else []
        }


class Speaker(Base):
    """Speakers table for diarization"""
    __tablename__ = "speakers"
    
    id = Column(Integer, primary_key=True, index=True)
    recording_id = Column(Integer, ForeignKey("recordings.id"), nullable=False, index=True)
    speaker_label = Column(String(50), nullable=False)  # e.g., "Speaker 0"
    user_name = Column(String(255), nullable=True)  # e.g., "Alice Johnson"
    segment_count = Column(Integer, default=0)  # Number of segments by this speaker
    total_duration = Column(Integer, default=0)  # Total speaking time in seconds
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    recording = relationship("Recording", back_populates="speakers")
    
    def to_dict(self):
        """Convert to dictionary for JSON serialization"""
        return {
            "id": self.id,
            "recording_id": self.recording_id,
            "speaker_label": self.speaker_label,
            "user_name": self.user_name,
            "segment_count": self.segment_count,
            "total_duration": self.total_duration
        }


# ==================== Database Functions ====================

def init_database():
    """Initialize the database and create all tables"""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info(f"Database initialized: {DATABASE_FILE}")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


@contextmanager
def get_db_session():
    """
    Context manager for database sessions
    Usage:
        with get_db_session() as session:
            recording = session.query(Recording).first()
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception as e:
        session.rollback()
        logger.error(f"Database session error: {e}")
        raise
    finally:
        session.close()


# ==================== CRUD Operations ====================

def create_recording(title, video_path, file_size_mb=0):
    """Create a new recording entry"""
    with get_db_session() as session:
        recording = Recording(
            title=title,
            video_path=video_path,
            file_size_mb=file_size_mb,
            status="processing"
        )
        session.add(recording)
        session.flush()
        recording_id = recording.id
        logger.info(f"Created recording #{recording_id}: {title}")
        return recording_id


def get_recording(recording_id):
    """Get a recording by ID"""
    with get_db_session() as session:
        recording = session.query(Recording).filter(Recording.id == recording_id).first()
        if recording:
            return recording.to_dict()
        return None


def get_all_recordings(limit=100, offset=0, status=None):
    """Get all recordings, optionally filtered by status"""
    with get_db_session() as session:
        query = session.query(Recording)
        
        if status:
            query = query.filter(Recording.status == status)
        
        query = query.order_by(Recording.created_at.desc())
        query = query.limit(limit).offset(offset)
        
        recordings = query.all()
        return [r.to_dict() for r in recordings]


def update_recording(recording_id, **kwargs):
    """Update recording fields"""
    with get_db_session() as session:
        recording = session.query(Recording).filter(Recording.id == recording_id).first()
        
        if not recording:
            raise ValueError(f"Recording #{recording_id} not found")
        
        for key, value in kwargs.items():
            if hasattr(recording, key):
                setattr(recording, key, value)
        
        recording.updated_at = datetime.utcnow()
        logger.info(f"Updated recording #{recording_id}")


def update_recording_status(recording_id, status, error_message=None):
    """Update recording status"""
    update_data = {"status": status}
    if error_message:
        update_data["error_message"] = error_message
    update_recording(recording_id, **update_data)


def delete_recording(recording_id):
    """Delete a recording and its speakers"""
    with get_db_session() as session:
        recording = session.query(Recording).filter(Recording.id == recording_id).first()
        
        if not recording:
            raise ValueError(f"Recording #{recording_id} not found")
        
        # SQLAlchemy cascade will delete related speakers
        session.delete(recording)
        logger.info(f"Deleted recording #{recording_id}")


def create_or_update_speaker(recording_id, speaker_label, user_name=None, segment_count=0, total_duration=0):
    """Create or update a speaker entry"""
    with get_db_session() as session:
        speaker = session.query(Speaker).filter(
            Speaker.recording_id == recording_id,
            Speaker.speaker_label == speaker_label
        ).first()
        
        if speaker:
            # Update existing
            if user_name:
                speaker.user_name = user_name
            speaker.segment_count = segment_count
            speaker.total_duration = total_duration
            logger.info(f"Updated speaker {speaker_label} for recording #{recording_id}")
        else:
            # Create new
            speaker = Speaker(
                recording_id=recording_id,
                speaker_label=speaker_label,
                user_name=user_name,
                segment_count=segment_count,
                total_duration=total_duration
            )
            session.add(speaker)
            logger.info(f"Created speaker {speaker_label} for recording #{recording_id}")
        
        session.flush()
        return speaker.id


def update_speaker_name(recording_id, speaker_label, user_name):
    """Update speaker's user name (rename functionality)"""
    with get_db_session() as session:
        speaker = session.query(Speaker).filter(
            Speaker.recording_id == recording_id,
            Speaker.speaker_label == speaker_label
        ).first()
        
        if not speaker:
            raise ValueError(f"Speaker {speaker_label} not found for recording #{recording_id}")
        
        speaker.user_name = user_name
        logger.info(f"Renamed {speaker_label} to {user_name} for recording #{recording_id}")


def get_speakers_for_recording(recording_id):
    """Get all speakers for a recording"""
    with get_db_session() as session:
        speakers = session.query(Speaker).filter(Speaker.recording_id == recording_id).all()
        return [s.to_dict() for s in speakers]


def get_database_stats():
    """Get database statistics"""
    with get_db_session() as session:
        total_recordings = session.query(Recording).count()
        completed = session.query(Recording).filter(Recording.status == "completed").count()
        processing = session.query(Recording).filter(Recording.status == "processing").count()
        failed = session.query(Recording).filter(Recording.status == "failed").count()
        
        return {
            "total_recordings": total_recordings,
            "completed": completed,
            "processing": processing,
            "failed": failed
        }


# Initialize database on module import
if not os.path.exists(DATABASE_FILE):
    logger.info("Database not found, creating new database...")
    init_database()
else:
    logger.info(f"Database found: {DATABASE_FILE}")