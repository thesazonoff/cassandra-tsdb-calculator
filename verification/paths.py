"""Пути стенда проверки. Переопределяются переменными окружения.

CASSANDRA_HOME  распакованный apache-cassandra-5.0.9 (по умолчанию work/apache-cassandra-5.0.9, его скачивает run.sh)
CASSANDRA_SRC   исходники apache/cassandra на теге cassandra-5.0.9 (нужны только verify_legacy.py)
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, 'work')
RESULTS = os.path.join(HERE, 'results')
JAVA_BUILD = os.path.join(WORK, 'java')
CASSANDRA_HOME = os.environ.get('CASSANDRA_HOME', os.path.join(WORK, 'apache-cassandra-5.0.9'))
CASSANDRA_SRC = os.environ.get('CASSANDRA_SRC', os.path.join(WORK, 'cassandra-src'))
COMP_GRID = os.path.join(HERE, '..', 'src', 'core', 'data', 'comp-grid.json')


def result(name):
    os.makedirs(RESULTS, exist_ok=True)
    return os.path.join(RESULTS, name)
