from src.enums.user_type import UserType

class User():
    def __init__(self, id: str, email: str, phone_number: str, username: str, password: str, user_type: UserType):
        self.id = id
        self.email = email
        self.phone_number = phone_number
        self.username = username
        self.password = password
        self.user_type = user_type

