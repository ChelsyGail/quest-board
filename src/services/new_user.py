from src.models.user import User
from src.enums.user_type import UserType


new_user_input = int(input("What type of account are you creating? enter 1 for Student or 0 for Admin"))


if new_user_input == 0:
    chosen_type = UserType.ADMIN
    print("This is your quest")
else:
    chosen_type = UserType.STUDENT


user_id, email, phone_number, username, password = input("Enter id,email,phone,username,password: ").split(",")
new_user = User(user_id, email, phone_number, username, password, chosen_type)
print(new_user.user_type)
