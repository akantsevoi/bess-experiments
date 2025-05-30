.PHONY start-env freeze-deps

start-env:
	python -m venv .venv
	source .venv/bin/activate
	pip install -r requirements.txt

freeze-deps:
	pip freeze > requirements.txt